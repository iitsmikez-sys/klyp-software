"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/track";
import { FREE_TOP_UNLOCKED } from "@/lib/free-taste";

export type LockedClip = { title: string; score: number };

/**
 * Shown to a Free account under its unlocked clips: the rest of the clips the analysis found, with their titles and scores but no
 * way to open them. Starting the Pro pass unlocks them with no extra Sparks (the analysis is already paid for).
 */
export default function LockedClips({ clips }: { clips: LockedClip[] }) {
  const count = clips.length;
  useEffect(() => { if (count > 0) void trackEvent("locked_clips_view", { locked: count }); }, [count]);
  if (count === 0) return null;
  return (
    <section data-locked-clips aria-label="More clips with Pro" className="mt-6 rounded-2xl border border-accent/40 bg-accent-glow p-5">
      <h3 className="font-syne text-lg font-bold text-foreground">{count} more {count === 1 ? "clip" : "clips"} found</h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
        Your best {FREE_TOP_UNLOCKED} are unlocked above. The Pro pass unlocks the rest, with no extra Sparks.
      </p>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2/60 text-sm">
        {clips.map((clip, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2.5 text-foreground-muted">
            <span aria-hidden="true">🔒</span>
            <span className="min-w-0 flex-1 truncate">{clip.title}</span>
            <span className="tabular-nums">{Math.round(clip.score)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href="/dashboard/upgrade?need=unlock"
          onClick={() => void trackEvent("locked_clips_click", { locked: count })}
          className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-background transition-colors hover:bg-accent-dim"
        >
          Unlock all with the $3 pass
        </a>
        <span className="text-xs text-foreground-muted">4 days of Pro, then $28 a month unless you cancel. Cancel any time.</span>
      </div>
    </section>
  );
}
