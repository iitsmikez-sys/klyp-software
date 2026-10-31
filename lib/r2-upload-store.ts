import { createAdminClient } from '@/lib/supabase/admin';
import type { VodUpload, VodUploadRepository } from './r2-upload-flow';

function fromRow(row: Record<string, unknown>): VodUpload {
  return { id: String(row.id), userId: String(row.user_id), key: String(row.object_key),
    remoteId: String(row.remote_upload_id), filename: String(row.file_name),
    expectedBytes: Number(row.expected_bytes), status: row.status as VodUpload['status'],
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    expiresAt: String(row.session_expires_at) };
}

export const r2UploadRepository: VodUploadRepository = {
  async insert(row) {
    const { error } = await createAdminClient().from('vod_uploads').insert({
      id: row.id, user_id: row.userId, object_key: row.key,
      remote_upload_id: row.remoteId, file_name: row.filename,
      expected_bytes: row.expectedBytes, status: row.status, session_expires_at: row.expiresAt,
    });
    if (error) throw new Error(`Could not record VOD upload: ${error.message}`);
  },
  async get(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await createAdminClient().from('vod_uploads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Could not read VOD upload: ${error.message}`);
    return data ? fromRow(data) : null;
  },
  async markReady(id, durationSeconds) {
    const readyAt = new Date();
    const { data, error } = await createAdminClient().from('vod_uploads').update({
      status: 'ready', duration_seconds: durationSeconds, ready_at: readyAt.toISOString(),
      source_expires_at: new Date(readyAt.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
    }).eq('id', id).eq('status', 'uploading').select('id').maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'VOD upload was not available to finalize.');
  },
};
