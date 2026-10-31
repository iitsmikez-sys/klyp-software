import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, statfs, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { R2Object } from './r2.ts';

export const R2_SCRATCH_DIR = path.join(tmpdir(), 'klyp-r2-upload-scratch');
const RESERVE_BYTES = 512 * 1024 * 1024;
const SCRATCH_AGE_MS = 24 * 60 * 60_000;
const inflight = new Map<string, Promise<string>>();

type SourceRow = { id: string; key: string; expectedBytes: number; status: string };
type SourceStore = { head(key: string): Promise<R2Object | null>;
  downloadFile(key: string, target: string): Promise<number> };

async function diskFree(dir: string): Promise<number> {
  const info = await statfs(dir);
  return info.bavail * info.bsize;
}

/** Download only to ephemeral scratch. R2 remains the durable source after a
 * worker restart; a failed/incomplete scratch copy is never returned. */
export async function materializeR2Upload(row: SourceRow, r2: SourceStore,
  dir = R2_SCRATCH_DIR, freeBytes: (dir: string) => Promise<number> = diskFree): Promise<string> {
  if (row.status !== 'ready' || !/^[0-9a-f-]{36}$/i.test(row.id) ||
      !Number.isSafeInteger(row.expectedBytes) || row.expectedBytes < 1) {
    throw new Error('Uploaded VOD is not ready.');
  }
  const ext = path.extname(row.key).toLowerCase();
  if (!/^\.(mp4|mov|avi|mkv|webm|m4v)$/.test(ext)) throw new Error('Invalid uploaded VOD type.');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `upload-${row.id}${ext}`);
  const prior = inflight.get(target);
  if (prior) return prior;
  const work = (async () => {
    const remote = await r2.head(row.key);
    if (!remote || remote.bytes !== row.expectedBytes) throw new Error('Durable VOD copy is missing or incomplete.');
    try {
      if ((await stat(target)).size === row.expectedBytes) {
        await utimes(target, new Date(), new Date());
        return target;
      }
    } catch { /* no local scratch copy */ }
    if ((await freeBytes(dir)) < row.expectedBytes + RESERVE_BYTES) {
      throw new Error('Insufficient temporary disk space to process this VOD.');
    }
    const partial = `${target}.${randomUUID()}.part`;
    try {
      const bytes = await r2.downloadFile(row.key, partial);
      if (bytes !== row.expectedBytes || (await stat(partial)).size !== row.expectedBytes) {
        throw new Error('Downloaded VOD bytes did not match the verified object.');
      }
      await rename(partial, target);
      return target;
    } finally {
      await rm(partial, { force: true }).catch(() => {});
    }
  })();
  inflight.set(target, work);
  try { return await work; }
  finally { inflight.delete(target); }
}

/** Remove only old scratch copies. The 24h age exceeds Klyp's maximum single
 * job runtime; fresh reads refresh mtime. Never inspect the mounted upload
 * volume or R2 objects here. */
export async function cleanupR2Scratch(dir = R2_SCRATCH_DIR, now = Date.now(),
  maxAgeMs = SCRATCH_AGE_MS): Promise<number> {
  let names: string[];
  try { names = await readdir(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!/^upload-[0-9a-f-]{36}\.(mp4|mov|avi|mkv|webm|m4v)(\.[0-9a-f-]{36}\.part)?$/i.test(name)) continue;
    const target = path.join(dir, name);
    const activeTarget = target.replace(/\.[0-9a-f-]{36}\.part$/i, '');
    if (inflight.has(activeTarget)) continue;
    try {
      const info = await stat(target);
      if (info.mtimeMs + maxAgeMs > now) continue;
      await rm(target, { force: true });
      removed++;
    } catch { /* another worker removed it; retry later if necessary */ }
  }
  return removed;
}
