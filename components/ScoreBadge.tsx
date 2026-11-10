"use client";

import { isTopPick } from "@/lib/clip-extras";

/**
 * The AI score pill ("★ 71") for the top right corner of a clip's picture. Every clip shows its score, top picks and
 * near-miss extras alike; only the hover text differs. It sits over the thumbnail, so it ignores clicks.
 */
export default function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const top = isTopPick({ viral_score: score });
  return (
    <span
      data-score-badge
      title={`Klyp's own estimate of how strong this moment is, not a measured result. ${top ? "Moments scoring 65 or more are top picks." : "Below the 65 top-pick bar."}`}
      className="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-lg border border-accent/60 bg-background/80 px-2 py-0.5 text-[13px] font-semibold tabular-nums text-accent backdrop-blur-sm"
    >
      <span aria-hidden="true">★</span>
      <span aria-label={`AI score ${Math.round(score)}`}>{Math.round(score)}</span>
    </span>
  );
}
