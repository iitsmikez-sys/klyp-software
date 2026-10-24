/**
 * In-process concurrency limiter for the yt-dlp+ffmpeg processing jobs
 * (analyze/clip/preview/archive) — single Railway instance, single Node process.
 * Deliberately NOT Redis/BullMQ: this instance is the only thing running
 * these jobs, so an in-memory FIFO queue is sufficient and has zero new
 * infra. Horizontal scaling (multiple replicas needing shared queue state)
 * is a separate, later project — see MEMORY.md / project notes.
 *
 * State lives on globalThis because Next compiles routes into separate module
 * graphs; module-local counters can allow each route to fill the same CPU.
 * Caps how many jobs run at once so concurrent users don't each spawn their
 * own yt-dlp+ffmpeg pair and collectively exhaust the container's 2 vCPU /
 * ~1GB budget — the exact failure mode chased through most of this session,
 * just from aggregate load instead of one oversized request.
 */

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 2;

/**
 * Cap on how long a job can sit in the FIFO queue waiting for a free slot.
 * Every job that actually STARTS is already bounded by its own
 * stallTimeoutMs/maxRunMs (see lib/bin.ts) — but nothing previously bounded
 * the wait *before* that, so a burst of analyze/preview/clip requests could
 * leave a later request queued indefinitely with no error and no feedback,
 * which is exactly what made a busy container's "Burning & exporting…"
 * spinner look permanently hung instead of just waiting its turn.
 */
const MAX_QUEUE_WAIT_MS = Number(process.env.MAX_QUEUE_WAIT_MS) || 6 * 60_000;

type QueuedJob = {
  id: string;
  label: string;
  queuedAt: number;
  start: () => void;
};

type QueueState = { running: number; queue: QueuedJob[]; nextId: number };
const shared = globalThis as typeof globalThis & { __klypQueueState?: QueueState };
const state = shared.__klypQueueState ??= { running: 0, queue: [], nextId: 1 };

/** Pull jobs off the front of the queue while slots are free. Called after
 *  every enqueue and after every job finishes, so it's the only place that
 *  starts a job — no other code path is allowed to run one directly. */
function pump(): void {
  while (state.running < MAX_CONCURRENT_JOBS && state.queue.length > 0) {
    const job = state.queue.shift()!;
    state.running++;
    job.start();
  }
}

/**
 * Run `fn` under the concurrency cap. Runs immediately if a slot is free;
 * otherwise queues FIFO until one frees up. Resolves/rejects exactly as
 * `fn()` would on its own — the only difference is a possible delay before
 * it starts. Safe to call from concurrent requests: enqueue-then-pump is
 * synchronous (no `await` in between), so there's no race on `running`
 * despite Node's single-threaded event loop interleaving many requests.
 */
export function runQueued<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = `q${state.nextId++}`;
  const queuedAt = Date.now();
  const willQueue = state.running >= MAX_CONCURRENT_JOBS || state.queue.length > 0;

  if (willQueue) {
    console.log(`[queue] ${id} (${label}) queued — ${state.running}/${MAX_CONCURRENT_JOBS} slots busy, ${state.queue.length + 1} waiting`);
  } else {
    console.log(`[queue] ${id} (${label}) running immediately — ${state.running + 1}/${MAX_CONCURRENT_JOBS} slots in use`);
  }

  return new Promise<T>((resolve, reject) => {
    let waitTimer: NodeJS.Timeout;
    const job: QueuedJob = {
      id,
      label,
      queuedAt,
      start: () => {
        clearTimeout(waitTimer);
        const waitedMs = Date.now() - queuedAt;
        if (waitedMs > 50) {
          console.log(`[queue] ${id} (${label}) started after waiting ${waitedMs}ms`);
        }
        fn()
          .then(resolve, reject)
          .finally(() => {
            state.running--;
            pump();
          });
      },
    };
    // Gives up waiting (rather than resolving/rejecting via fn()) only if the
    // job is still sitting in the queue when this fires — a job already
    // pulled off by pump() has cleared this timer in start() above.
    waitTimer = setTimeout(() => {
      const idx = state.queue.indexOf(job);
      if (idx === -1) return;
      state.queue.splice(idx, 1);
      const waitedMs = Date.now() - queuedAt;
      console.log(
        `[queue] ${id} (${label}) gave up after waiting ${Math.round(waitedMs / 1000)}s — ` +
        `${state.running}/${MAX_CONCURRENT_JOBS} slots busy, ${state.queue.length} still waiting`
      );
      reject(
        new Error(
          `The server is too busy to start this right now (waited ${Math.round(waitedMs / 1000)}s for a free slot). Try again in a minute.`
        )
      );
    }, MAX_QUEUE_WAIT_MS);
    state.queue.push(job);
    pump();
  });
}

/** Current queue depth — backs GET /api/queue-status. */
export function queueStatus(): { running: number; queued: number; maxConcurrentJobs: number } {
  return { running: state.running, queued: state.queue.length, maxConcurrentJobs: MAX_CONCURRENT_JOBS };
}
