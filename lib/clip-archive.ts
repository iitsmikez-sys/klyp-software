/**
 * Reads archived clip media back out of the private `clip-media` bucket.
 *
 * Archiving is only half the fix: the preview, thumbnail and export routes all
 * cut from the source VOD, so a saved clip still broke once Twitch deleted the
 * source. These helpers let those routes prefer the archive and fall back to
 * the source only when there isn't one.
 *
 * Ownership is enforced here, not by the caller: every lookup is scoped to the
 * requesting user's id, so a clip id belonging to someone else resolves to
 * nothing. The bucket itself is private — objects are only ever read with a
 * short-lived service-signed URL or straight through the service client — so
 * nothing is reachable by guessing a path.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { r2Storage } from '@/lib/r2';
import { recordR2UsageEvent } from '@/lib/r2-usage';

export const CLIP_BUCKET = "clip-media";

export type ArchivedClip = {
  id: string;
  originalStartSeconds: number;
  originalEndSeconds: number;
  masterPath: string | null;
  proxyPath: string | null;
  posterPath: string | null;
  status: string;
  provider: 'supabase' | 'r2';
};

/**
 * The archive record for one of this user's clips, or null when the id isn't
 * theirs, doesn't exist, or was never archived.
 */
export async function getArchivedClip(clipId: string, userId: string): Promise<ArchivedClip | null> {
  if (!clipId || !userId) return null;
  const admin = createAdminClient();
  const columns: string = process.env.R2_ENABLED === '1'
    ? 'id, start_seconds, end_seconds, master_path, proxy_path, poster_path, archive_status, archive_provider'
    : 'id, start_seconds, end_seconds, master_path, proxy_path, poster_path, archive_status';
  const { data, error } = await admin
    .from("clips")
    .select(columns)
    .eq("id", clipId)
    .eq("user_id", userId) // scoping, not decoration: this is the access check
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as { id: string; start_seconds: number; end_seconds: number;
    master_path: string | null; proxy_path: string | null; poster_path: string | null;
    archive_status: string; archive_provider?: string };
  return {
    id: row.id,
    originalStartSeconds: row.start_seconds,
    originalEndSeconds: row.end_seconds,
    masterPath: row.master_path,
    proxyPath: row.proxy_path,
    posterPath: row.poster_path,
    status: row.archive_status,
    provider: row.archive_provider === 'r2' ? 'r2' : 'supabase',
  };
}

/** Download one archived object into memory. Null if it has gone missing. */
export async function readArchivedObject(objectPath: string, provider: 'supabase' | 'r2' = 'supabase'): Promise<Buffer | null> {
  if (provider === 'r2') {
    const r2 = r2Storage();
    if (!r2) throw new Error('R2 archived media is not configured.');
    const dir = await mkdtemp(path.join(tmpdir(), 'klyp-r2-read-'));
    try {
      const target = path.join(dir, 'media');
      await r2.downloadFile(objectPath, target);
      const bytes = await readFile(target);
      const userId = /^clips\/([0-9a-f-]{36})\//i.exec(objectPath)?.[1];
      await recordR2UsageEvent({ userId, objectKey: objectPath,
        operation: 'media_read', bytes: bytes.length }).catch(() => {
        console.warn('[r2-usage] media read metric unavailable');
      });
      return bytes;
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(CLIP_BUCKET).download(objectPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Short-lived signed URL for an archived object. Used where a client can read
 * the bytes directly; the expiry keeps a leaked link from being durable.
 */
export async function signArchivedObject(objectPath: string, expiresInSeconds = 300,
  provider: 'supabase' | 'r2' = 'supabase'): Promise<string | null> {
  if (provider === 'r2') {
    const r2 = r2Storage();
    if (!r2) throw new Error('R2 archived media is not configured.');
    return r2.signedGet(objectPath, expiresInSeconds);
  }
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(CLIP_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
