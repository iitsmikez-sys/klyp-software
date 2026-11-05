"use client";

/** "Your last analysis is ready": shown on the Analyze page when someone left before saving their clips. */
export type LastAnalysis = {
  id: string; url: string; completedAt: string; keptDays: number; daysLeft: number; clipCount: number; topTitle: string | null;
};

function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export default function LastAnalysisBanner({ job, onView, onDismiss }: {
  job: LastAnalysis; onView: () => void; onDismiss: () => void;
}) {
  const left = job.daysLeft <= 1 ? "less than a day" : `${job.daysLeft} more days`;
  return (
    <div role="status" data-last-analysis className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-glow p-3 sm:p-4">
      <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent text-background">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="font-semibold text-foreground">Your last analysis is ready</p>
        <p className="text-sm text-foreground-muted">
          {job.clipCount} clip{job.clipCount === 1 ? "" : "s"} · {ago(job.completedAt)} · kept {left}
        </p>
        {job.topTitle && <p className="mt-0.5 truncate text-sm text-foreground-muted">Top clip: <span className="text-foreground">&ldquo;{job.topTitle}&rdquo;</span></p>}
      </div>
      <div className="flex flex-none gap-2">
        <button type="button" onClick={onView} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-background transition-colors hover:bg-accent-dim">View my clips</button>
        <button type="button" onClick={onDismiss} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted transition-colors hover:text-foreground">Dismiss</button>
      </div>
    </div>
  );
}
