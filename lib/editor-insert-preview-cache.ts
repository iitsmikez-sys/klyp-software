/**
 * Preview files for inserted photos and videos, fetched and decoded before the playhead reaches them. Without
 * this the preview asks for a signed link and loads the picture only when the insert starts, and the playhead
 * waits (the visible pause). Entries are dropped 30 seconds before the signed link expires.
 */
import type { EditorAsset } from "./editor-assets.ts";
import { mediaResponse } from "./editor-media-client.ts";

export type InsertPreview = { asset: EditorAsset; url: string; expiresAt: number };
const SAFETY_MS = 30_000;
const done = new Map<string, InsertPreview>();
const pending = new Map<string, Promise<InsertPreview>>();
// Keep the warmed elements alive so the browser keeps the decoded picture or buffered video.
const warmed = new Map<string, unknown>();
const keyOf = (clipId: string, assetId: string) => `${clipId}:${assetId}`;

/** A still-valid preview, or null. */
export function cachedInsertPreview(clipId: string, assetId: string, now = Date.now()): InsertPreview | null {
  const hit = done.get(keyOf(clipId, assetId));
  if (hit && hit.expiresAt - SAFETY_MS > now) return hit;
  if (hit) { done.delete(keyOf(clipId, assetId)); warmed.delete(keyOf(clipId, assetId)); }
  return null;
}

function warm(key: string, entry: InsertPreview) {
  try {
    if (entry.asset.kind === "photo" && typeof Image !== "undefined") {
      const image = new Image();
      image.src = entry.url;
      void image.decode?.().catch(() => { /* the visible element reports a real failure */ });
      warmed.set(key, image);
    } else if (entry.asset.kind === "video" && typeof document !== "undefined") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = entry.url;
      warmed.set(key, video);
    }
  } catch { /* warming is best effort */ }
}

/** Fetch the signed preview once, share it between callers, and warm the file. */
export function prefetchInsertPreview(clipId: string, assetId: string): Promise<InsertPreview> {
  const key = keyOf(clipId, assetId);
  const hit = cachedInsertPreview(clipId, assetId);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(key);
  if (running) return running;
  const request = fetch(`/api/clips/${clipId}/media/${assetId}`)
    .then((response) => mediaResponse<{ asset: EditorAsset; preview_url: string; expires_in: number }>(response))
    .then((data) => {
      const entry: InsertPreview = { asset: data.asset, url: data.preview_url, expiresAt: Date.now() + data.expires_in * 1000 };
      done.set(key, entry);
      warm(key, entry);
      return entry;
    })
    .finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}

/** For tests. */
export function clearInsertPreviewCache() { done.clear(); pending.clear(); warmed.clear(); }
