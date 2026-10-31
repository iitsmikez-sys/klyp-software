import { createAdminClient } from '@/lib/supabase/admin';

export type R2UsageOperation = 'vod_upload' | 'archive_write' | 'archive_verify_read' |
  'media_read' | 'media_delete' | 'multipart_abort';

/** Operation counts and bytes are measurements, not an R2 or Railway bill.
 * A stable event key makes retries safe for finalized uploads/archives. */
export async function recordR2UsageEvent(event: {
  eventKey?: string; userId?: string; objectKey: string;
  operation: R2UsageOperation; bytes: number; requestCount?: number;
}): Promise<void> {
  if (!Number.isSafeInteger(event.bytes) || event.bytes < 0 ||
      !Number.isSafeInteger(event.requestCount ?? 1) || (event.requestCount ?? 1) < 1) {
    throw new Error('Invalid R2 usage measurement.');
  }
  const { error } = await createAdminClient().from('r2_usage_events').insert({
    event_key: event.eventKey ?? null,
    user_id: event.userId ?? null,
    object_key: event.objectKey,
    operation: event.operation,
    bytes: event.bytes,
    request_count: event.requestCount ?? 1,
  });
  if (error && !(event.eventKey && error.code === '23505')) throw error;
}
