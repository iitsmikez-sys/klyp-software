import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_CACHE_DIR = path.join(tmpdir(), 'klyp-analysis-audio');
const TTL_MS = 30 * 24 * 3600_000;
const MAX_BYTES = 3 * 1024 ** 3;
const inflight = new Map<string, Promise<{ path: string; cacheHit: boolean }>>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type AudioCacheOptions = {
  cacheDir?: string;
  userId: string;
  sourceKey: string;
  durationSeconds: number;
  create: (target: string) => Promise<void>;
};

async function complete(file: string): Promise<boolean> {
  try { const info = await stat(file); return info.size > 0 && Date.now() - info.mtimeMs < TTL_MS; }
  catch { return false; }
}

async function prune(dir: string, keep: string): Promise<void> {
  const entries = await readdir(dir);
  const files = (await Promise.all(entries.filter(name => name.endsWith('.m4a'))
    .map(async name => ({ name, info: await stat(path.join(dir, name)) }))));
  let total = files.reduce((sum, file) => sum + file.info.size, 0);
  for (const file of files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
    if (total <= MAX_BYTES) break;
    if (file.name === keep) continue;
    await unlink(path.join(dir, file.name)).catch(() => {});
    total -= file.info.size;
  }
}

/** Reuse a complete per-user VOD audio file; lock across concurrent workers. */
export async function ensureCachedAnalysisAudio(options: AudioCacheOptions): Promise<{ path: string; cacheHit: boolean }> {
  if (!options.userId || !options.sourceKey || !Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new Error('Invalid analysis audio cache identity');
  }
  const dir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  await mkdir(dir, { recursive: true });
  const key = createHash('sha256').update(`${options.userId}\n${options.sourceKey}\n${Math.round(options.durationSeconds)}\nv2`).digest('hex');
  const file = path.join(dir, `${key}.m4a`);
  if (await complete(file)) return { path: file, cacheHit: true };
  const existing = inflight.get(file);
  if (existing) { const result = await existing; return { path: result.path, cacheHit: true }; }
  const promise = (async () => {
    const lock = `${file}.lock`;
    let owned = false;
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      if (await complete(file)) return { path: file, cacheHit: true };
      try { const handle = await open(lock, 'wx'); await handle.close(); owned = true; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = await stat(lock).then(s => Date.now() - s.mtimeMs).catch(() => 0);
        if (age > 40 * 60_000) await unlink(lock).catch(() => {});
        await sleep(500);
      }
    }
    if (!owned) throw new Error('Timed out waiting for VOD audio download');
    const temporary = path.join(dir, `${key}.${randomUUID()}.tmp`);
    try {
      if (await complete(file)) return { path: file, cacheHit: true };
      await options.create(temporary);
      if (!(await stat(temporary)).size) throw new Error('VOD audio download was empty');
      await rename(temporary, file);
      await prune(dir, path.basename(file));
      return { path: file, cacheHit: false };
    } finally {
      await unlink(temporary).catch(() => {});
      await unlink(lock).catch(() => {});
    }
  })();
  inflight.set(file, promise);
  try { return await promise; } finally { inflight.delete(file); }
}
