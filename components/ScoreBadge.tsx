/** Klyp's AI score for a clip (0-100): the model's estimate of its viral potential. */
export default function ScoreBadge({ score, className = "" }: { score: number; className?: string }) {
  const s = Math.round(score);
  const tone = s >= 85
    ? "bg-accent text-background"
    : s >= 75
      ? "border border-accent/40 bg-background/80 text-accent"
      : "border border-white/20 bg-black/70 text-white";
  return (
    <span
      title="Klyp's AI score: its estimate of this moment's viral potential. Only moments scoring 65 or more are returned, and 90+ could go viral."
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-bold tabular-nums ${tone} ${className}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="12 2 15 9 22 9 16 13 18 20 12 16 6 20 8 13 2 9 9 9" />
      </svg>
      <span className="sr-only">AI score </span>
      {s}
    </span>
  );
}
