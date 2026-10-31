/** Opt-in maintenance; no remote deletion occurs without the explicit flag. */
import { createAdminClient } from '@/lib/supabase/admin';
import { r2Storage } from './r2';
import { cleanupR2Scratch } from './r2-upload-source';
import { processR2CleanupJob, type R2CleanupJob, type R2CleanupQueue } from './r2-retention';
import { recordR2UsageEvent } from './r2-usage';

let running = false;

export async function processR2Maintenance(): Promise<void> {
  if (running || process.env.R2_RETENTION_CLEANUP_ENABLED !== '1') return;
  const r2 = r2Storage();
  if (!r2) throw new Error('R2 cleanup was enabled without private R2 configuration.');
  running = true;
  try {
    const admin = createAdminClient();
    const { error: scheduleError } = await admin.rpc('schedule_expired_r2_media');
    if (scheduleError) throw scheduleError;
    const queue: R2CleanupQueue = {
      async claim() {
        const { data, error } = await admin.rpc('claim_r2_cleanup_object');
        if (error) throw error;
        const row = (data as Array<{ job_id: number; object_key: string;
          operation: 'delete' | 'abort'; remote_upload_id: string | null }> | null)?.[0];
        return row ? { id: row.job_id, key: row.object_key,
          operation: row.operation, remoteId: row.remote_upload_id } satisfies R2CleanupJob : null;
      },
      async finish(id) {
        const { error } = await admin.rpc('finish_r2_cleanup_object', { p_job_id: id });
        if (error) throw error;
      },
      async fail(id, message) {
        const { error } = await admin.rpc('fail_r2_cleanup_object', { p_job_id: id, p_error: message });
        if (error) throw error;
      },
    };
    await processR2CleanupJob(queue, r2, async (job, deletedBytes) => {
      const userId = /^(?:vod|clips)\/([0-9a-f-]{36})\//i.exec(job.key)?.[1];
      await recordR2UsageEvent({ eventKey: `cleanup:${job.id}`, userId,
        objectKey: job.key, operation: job.operation === 'abort' ? 'multipart_abort' : 'media_delete',
        bytes: deletedBytes });
    });
    await cleanupR2Scratch();
  } finally { running = false; }
}
