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

export const CLIP_BUCKET = "clip-media";

export type ArchivedClip = {
  id: string;
  originalStartSeconds: number;
  originalEndSeconds: number;
  masterPath: string | null;
  proxyPath: string | null;
  posterPath: string | null;
  status: string;
};

/**
 * The archive record for one of this user's clips, or null when the id isn't
 * theirs, doesn't exist, or was never archived.
 */
export async function getArchivedClip(clipId: string, userId: string): Promise<ArchivedClip | null> {
  if (!clipId || !userId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clips")
    .select("id, start_seconds, end_seconds, master_path, proxy_path, poster_path, archive_status")
    .eq("id", clipId)
    .eq("user_id", userId) // scoping, not decoration: this is the access check
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    originalStartSeconds: data.start_seconds,
    originalEndSeconds: data.end_seconds,
    masterPath: data.master_path,
    proxyPath: data.proxy_path,
    posterPath: data.poster_path,
    status: data.archive_status,
  };
}

/** Download one archived object into memory. Null if it has gone missing. */
export async function readArchivedObject(objectPath: string): Promise<Buffer | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(CLIP_BUCKET).download(objectPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Short-lived signed URL for an archived object. Used where a client can read
 * the bytes directly; the expiry keeps a leaked link from being durable.
 */
export async function signArchivedObject(objectPath: string, expiresInSeconds = 300): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(CLIP_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
