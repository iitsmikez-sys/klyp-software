/**
 * In-process concurrency limiter for the yt-dlp+ffmpeg processing jobs
 * (analyze/clip/preview) — single Railway instance, single Node process.
 * Deliberately NOT Redis/BullMQ: this instance is the only thing running
 * these jobs, so an in-memory FIFO queue is sufficient and has zero new
 * infra. Horizontal scaling (multiple replicas needing shared queue state)
 * is a separate, later project — see MEMORY.md / project notes.
 *
 * Caps how many jobs run at once so concurrent users don't each spawn their
 * own yt-dlp+ffmpeg pair and collectively exhaust the container's 2 vCPU /
 * ~1GB budget — the exact failure mode chased through most of this session,
 * just from aggregate load instead of one oversized request.
 */

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 2;

type QueuedJob = {
  id: string;
  label: string;
  queuedAt: number;
  start: () => void;
};

let running = 0;
const queue: QueuedJob[] = [];
let nextId = 1;

/** Pull jobs off the front of the queue while slots are free. Called after
 *  every enqueue and after every job finishes, so it's the only place that
 *  starts a job — no other code path is allowed to run one directly. */
function pump(): void {
  while (running < MAX_CONCURRENT_JOBS && queue.length > 0) {
    const job = queue.shift()!;
    running++;
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
  const id = `q${nextId++}`;
  const queuedAt = Date.now();
  const willQueue = running >= MAX_CONCURRENT_JOBS || queue.length > 0;

  if (willQueue) {
    console.log(`[queue] ${id} (${label}) queued — ${running}/${MAX_CONCURRENT_JOBS} slots busy, ${queue.length + 1} waiting`);
  } else {
    console.log(`[queue] ${id} (${label}) running immediately — ${running + 1}/${MAX_CONCURRENT_JOBS} slots in use`);
  }

  return new Promise<T>((resolve, reject) => {
    queue.push({
      id,
      label,
      queuedAt,
      start: () => {
        const waitedMs = Date.now() - queuedAt;
        if (waitedMs > 50) {
          console.log(`[queue] ${id} (${label}) started after waiting ${waitedMs}ms`);
        }
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--;
            pump();
          });
      },
    });
    pump();
  });
}

/** Current queue depth — backs GET /api/queue-status. */
export function queueStatus(): { running: number; queued: number; maxConcurrentJobs: number } {
  return { running, queued: queue.length, maxConcurrentJobs: MAX_CONCURRENT_JOBS };
}
