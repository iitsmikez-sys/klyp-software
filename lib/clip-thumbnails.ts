"use client";

/**
 * Process-wide cache of generated clip frames.
 *
 * Two callers want the same image: the card's poster and the preview dialog,
 * which shows it immediately while the video is still being cut. Without a
 * shared cache the dialog would fire a second /api/thumbnail request for a
 * frame the card already has — a wasted round trip, and on a cold cache a
 * second segment download.
 *
 * Entries live for the page's lifetime. A frame is ~25KB, so even a full
 * clips page is a couple of megabytes, and object URLs stay valid for any
 * component that mounts later.
 */
import { processingFetch } from "@/lib/processing-api";
import type { SavedClip } from "@/lib/clip-ui";

type ThumbClip = Pick<SavedClip, "url" | "start_seconds" | "end_seconds">;

/** Same identity the server caches by: source plus exact range. */
function keyFor(clip: ThumbClip): string {
  return `${clip.url}|${Math.floor(clip.start_seconds)}|${Math.ceil(clip.end_seconds)}`;
}

const ready = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** The frame for this clip if it has already been fetched, else null. */
export function peekClipThumbnail(clip: ThumbClip): string | null {
  return ready.get(keyFor(clip)) ?? null;
}

/**
 * Fetch this clip's frame, joining an in-flight request for the same clip
 * rather than starting a second one. Rejects if the frame can't be produced;
 * callers fall back to their placeholder.
 */
export function loadClipThumbnail(clip: ThumbClip): Promise<string> {
  const key = keyFor(clip);

  const cached = ready.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = processingFetch("/api/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: clip.url,
      start_seconds: clip.start_seconds,
      end_seconds: clip.end_seconds,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Thumbnail failed (HTTP ${res.status}).`);
      return res.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      ready.set(key, objectUrl);
      return objectUrl;
    })
    .finally(() => {
      // Clear either way: a failure should be retryable on the next mount.
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
