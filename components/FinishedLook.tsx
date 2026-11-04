"use client";
/**
 * Live preview of the "ready clip" look (lib/ready-clip.ts) over the clip view's player: a vertical
 * frame with a blurred backdrop, the video as a zoomed square, the hook in a white box on top and
 * Pulse-style captions below. Nothing is rendered; it is CSS over the same video, and the caption
 * timing uses the same cue builder as the real export.
 */
import { useEffect, useMemo, useState, type RefObject } from "react";
import { buildCaptionCues } from "@/lib/captions";
import { clipTimeMs } from "@/lib/clip-trim";
import type { TimedWord } from "@/lib/clips";

/** Frame width in px; the 9:16 height follows from it. */
export const FINISHED_FRAME_WIDTH = 300;

export function LookSwitch({ finished, onChange }: { finished: boolean; onChange: (finished: boolean) => void }) {
  const base = "rounded-lg border px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent";
  return (
    <div role="group" aria-label="Preview look" className="mx-6 mt-3 flex gap-2">
      <button type="button" aria-pressed={finished} onClick={() => onChange(true)}
        className={`${base} ${finished ? "border-accent/60 bg-surface-2 text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"}`}>Finished look</button>
      <button type="button" aria-pressed={!finished} onClick={() => onChange(false)}
        className={`${base} ${!finished ? "border-accent/60 bg-surface-2 text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"}`}>Original footage</button>
    </div>
  );
}

/** Blurred copy of the clip's own frame filling the vertical canvas behind the video. */
export function FinishedBackdrop({ poster }: { poster: string | null }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-surface-2">
      {poster && <img src={poster} alt="" className="h-full w-full scale-125 object-cover" style={{ filter: "blur(18px)" }} />}
    </div>
  );
}

/** The caption that is on screen right now, following the video's own clock. */
function useCaption(videoRef: RefObject<HTMLVideoElement | null>, words: TimedWord[] | null | undefined, startSeconds: number, endSeconds: number, active: boolean, leadSeconds = 0) {
  const cues = useMemo(
    () => (words?.length ? buildCaptionCues(words, startSeconds * 1000, endSeconds * 1000) : []),
    [words, startSeconds, endSeconds]
  );
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active || cues.length === 0) { setText(""); return; }
    let frame = 0;
    const tick = () => {
      // The saved clip file can start up to a second before the clip (whole-second cut), so clip time is video time minus that lead.
      const ms = clipTimeMs(videoRef.current?.currentTime ?? 0, leadSeconds);
      const cue = cues.find((c) => ms >= c.startMs && ms < c.endMs);
      setText((prev) => (prev === (cue?.text ?? "") ? prev : cue?.text ?? ""));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, cues, videoRef, leadSeconds]);
  return text;
}

/** Hook box and captions, placed where the finished clip puts them (percent of the 9:16 frame). */
export function FinishedOverlays({ hook, words, startSeconds, endSeconds, videoRef, leadSeconds = 0 }: {
  hook?: string | null; words?: TimedWord[] | null; startSeconds: number; endSeconds: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** How far into the video file the clip starts (0 when the file begins exactly at the clip). */
  leadSeconds?: number;
}) {
  const caption = useCaption(videoRef, words, startSeconds, endSeconds, true, leadSeconds);
  return (
    <>
      {hook && (
        <div className="pointer-events-none absolute left-1/2 w-[72%] -translate-x-1/2 rounded-md bg-white px-[3%] py-[2%] text-center font-extrabold uppercase leading-tight text-black"
          style={{ top: "11%", fontSize: "5.4cqw" }}>
          {hook}
        </div>
      )}
      {caption && (
        <div className="pointer-events-none absolute inset-x-0 px-[6%] text-center font-extrabold uppercase leading-tight text-white"
          style={{ top: "72%", fontSize: "6.4cqw", textShadow: "0 0 3px #000, 0 0 3px #000, 0 2px 4px #000" }}>
          {caption}
        </div>
      )}
    </>
  );
}
