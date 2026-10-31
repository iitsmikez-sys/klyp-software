import type { R2Object } from './r2.ts';

export type R2CleanupJob = { id: number; key: string; operation: 'delete' | 'abort'; remoteId: string | null };
export type R2CleanupQueue = {
  claim(): Promise<R2CleanupJob | null>;
  finish(id: number): Promise<void>;
  fail(id: number, message: string): Promise<void>;
};
export type R2CleanupStore = {
  delete(key: string): Promise<void>;
  head(key: string): Promise<R2Object | null>;
  abort(key: string, remoteId: string): Promise<void>;
};

/** One leased job per call. A crash reclaims the lease; S3 deletion is
 * idempotent. Never mark a job done until R2 confirms the key is absent. */
export async function processR2CleanupJob(queue: R2CleanupQueue, r2: R2CleanupStore,
  onDone?: (job: R2CleanupJob, deletedBytes: number) => Promise<void>): Promise<boolean> {
  const job = await queue.claim();
  if (!job) return false;
  try {
    if (job.operation === 'abort') {
      if (!job.remoteId) throw new Error('Missing multipart upload ID.');
      try { await r2.abort(job.key, job.remoteId); }
      catch (error) {
        const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
        if (!['NoSuchUpload', 'NotFound'].includes(name)) throw error;
      }
    }
    const before = await r2.head(job.key);
    if (job.operation === 'delete' || before) await r2.delete(job.key);
    if (await r2.head(job.key)) throw new Error('R2 object still exists after cleanup.');
    await onDone?.(job, before?.bytes ?? 0);
    await queue.finish(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.name : 'cleanup failed';
    await queue.fail(job.id, message);
  }
  return true;
}
