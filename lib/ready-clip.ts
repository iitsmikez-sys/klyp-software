/**
 * The "ready clip": one fixed, finished 9:16 look so a streamer can download a clip and post it.
 * The AI's first hook sits in a white box on top, Pulse captions run along the bottom, and the video
 * fills a zoomed square over a blurred copy of itself. Free exports get the Klyp watermark and Pro
 * exports are clean; the server already decides that, so nothing here depends on the plan.
 */
import type { CaptionStyle, TimedWord } from "./clips.ts";
import type { HookStyle } from "./captions.ts";

export const READY_CLIP_STYLE: CaptionStyle = "PULSE";
export const READY_CLIP_HOOK_STYLE: HookStyle = "WHITE_BOX";
export const READY_CLIP_ASPECT = "9:16";

/** Full source frame as the gameplay box, zoomed so the sides are cropped and it fills about two thirds of the height. */
export const READY_CLIP_LAYOUT = {
  version: 1,
  gameplay: { x: 0, y: 0, w: 1, h: 1 },
  fit: { zoom: 2.1, x: 0, y: 0 },
} as const;

type ReadyClipSource = {
  title: string;
  start_seconds: number;
  end_seconds: number;
  words?: TimedWord[] | null;
  hooks?: string[] | null;
};

/** The body POSTed to /api/clip for a ready clip. */
export function readyClipRequest(
  clip: ReadyClipSource,
  opts: { url: string; clipId?: string; handle?: string; hook?: string | null }
) {
  const hook = opts.hook ?? clip.hooks?.[0] ?? undefined;
  return {
    url: opts.url,
    start_seconds: clip.start_seconds,
    end_seconds: clip.end_seconds,
    title: clip.title,
    style: READY_CLIP_STYLE,
    words: clip.words ?? undefined,
    handle: opts.handle,
    hook: hook || undefined,
    hook_style: READY_CLIP_HOOK_STYLE,
    aspect_ratio: READY_CLIP_ASPECT,
    vertical_layout: READY_CLIP_LAYOUT,
    clip_id: opts.clipId || undefined,
  };
}
