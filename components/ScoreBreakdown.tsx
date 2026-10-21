"use client";

/**
 * The five dimensions behind a clip's viral score, as labelled bars.
 *
 * The model scores every candidate 0-20 on Hype, Emotional Intensity, Skill
 * Showcase, Comedic Value and Storyline Significance, then collapses them into
 * one holistic number. Two clips can both land on 73 while being nothing alike
 * — one a 19/2/0/4/7 comedy moment, the other flat 14s — and until these were
 * stored, that difference was computed and thrown away. This puts it back.
 *
 * Renders nothing for clips saved before migration 009: they have no
 * breakdown, and drawing empty bars would read as "scored zero" rather than
 * "never recorded".
 */
import { clipDimensions, type SavedClip } from "@/lib/clip-ui";

type Props = {
  clip: Pick<SavedClip, "dim_hype" | "dim_emotion" | "dim_skill" | "dim_comedy" | "dim_storyline">;
};

export default function ScoreBreakdown({ clip }: Props) {
  const dims = clipDimensions(clip);
  if (!dims) return null;

  // The strongest dimension is what makes the clip work, so it gets the accent
  // while the rest stay neutral — the shape of the profile at a glance.
  const peak = Math.max(...dims.map((d) => d.value));

  return (
    <div className="flex flex-col gap-1.5">
      {dims.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] text-muted tabular-nums">{d.label}</span>
          <span className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <span
              className={`block h-full rounded-full ${d.value === peak ? "bg-accent" : "bg-subtle"}`}
              style={{ width: `${(d.value / 20) * 100}%` }}
            />
          </span>
          <span className="w-7 shrink-0 text-right text-[11px] text-foreground-muted font-mono tabular-nums">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}
