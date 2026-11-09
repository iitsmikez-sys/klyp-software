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

type ThumbClip = Pick<SavedClip, "url" | "start_seconds" | "end_seconds"> & { id?: string };

/** Same identity the server caches by: source plus exact range. */
function keyFor(clip: ThumbClip): string {
  return `${clip.url}|${clip.start_seconds}|${clip.end_seconds}`;
}

const ready = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * At most this many frames are fetched at once. A results page has a card per clip; asking for every frame at the same moment
 * fills the account's few processing slots and makes a Download click wait or fail.
 */
const MAX_CONCURRENT_FRAMES = 2;
let activeFrames = 0;
const waitingFrames: Array<() => void> = [];
function acquireFrameTurn(): Promise<() => void> {
  const release = () => {
    activeFrames--;
    waitingFrames.shift()?.();
  };
  if (activeFrames < MAX_CONCURRENT_FRAMES) { activeFrames++; return Promise.resolve(release); }
  return new Promise((resolve) => waitingFrames.push(() => { activeFrames++; resolve(release); }));
}

/** The frame for this clip if it has already been fetched, else null. */
export function peekClipThumbnail(clip: ThumbClip): string | null {
  return ready.get(keyFor(clip)) ?? null;
}

/**
 * Fetch this clip's frame, joining an in-flight request for the same clip
 * rather than starting a second one. Rejects if the frame can't be produced;
 * callers fall back to their placeholder.
 */
export function invalidateClipThumbnail(clip: ThumbClip): void {
  ready.delete(keyFor(clip));
}

export function loadClipThumbnail(clip: ThumbClip): Promise<string> {
  const key = keyFor(clip);

  const cached = ready.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  // Wait for a turn (see MAX_CONCURRENT_FRAMES) before the request and its 45 second clock start.
  const request = acquireFrameTurn().then((release) => fetchThumbnail(clip, key).finally(release));
  inflight.set(key, request);
  request.then(() => inflight.delete(key), () => inflight.delete(key));
  return request;
}

function fetchThumbnail(clip: ThumbClip, key: string): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Thumbnail timed out. Try again."));
    }, 45_000);
  });
  const fetchFrame = processingFetch("/api/thumbnail", {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // clip_id lets the server serve this clip's archived poster, which
      // still exists after the source VOD is deleted.
      clip_id: clip.id,
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
      if (controller.signal.aborted) throw new Error("Thumbnail request expired.");
      if (!blob.size || !blob.type.startsWith("image/")) throw new Error("Invalid thumbnail response.");
      const objectUrl = URL.createObjectURL(blob);
      ready.set(key, objectUrl);
      return objectUrl;
    })
;
  // A failure clears the in-flight entry (in loadClipThumbnail), so it is retryable on the next mount.
  return Promise.race([fetchFrame, deadline]).finally(() => clearTimeout(timer));
}
