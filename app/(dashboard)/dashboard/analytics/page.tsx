"use client";

/**
 * Analytics — everything here is computed from the user's own clips rows.
 *
 * "AI score" is Klyp's own estimate of viral potential (clips.viral_score),
 * not a measured result from any platform, and the page says so rather than
 * letting a big number imply performance data Klyp does not have.
 *
 * The period filter applies to every section, so a selected range can
 * legitimately contain nothing — each panel has its own empty state instead of
 * silently falling back to all-time figures.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ClipThumbnail from "@/components/ClipThumbnail";
import ClipPreviewModal from "@/components/ClipPreviewModal";
import { useClipExports } from "@/components/useClipExports";
import { downloadExport } from "@/lib/clip-export";
import { type SavedClip, TYPE_STYLES, TYPE_BAR_COLORS, fmtTime, clipDuration } from "@/lib/clip-ui";

/* ── Period filter ── */
const PERIODS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const WEEKS_SHOWN = 8;
/** Clip types listed before "Show all" expands the rest. */
const TYPES_COLLAPSED = 5;

/** Score bands, highest first — labels say what the band means, not a claim. */
const BANDS = [
  { label: "85+", desc: "top-rated", min: 85, max: Infinity, color: "bg-accent" },
  { label: "70–84", desc: "strong", min: 70, max: 85, color: "bg-sky-400" },
  { label: "50–69", desc: "decent", min: 50, max: 70, color: "bg-amber-400" },
  { label: "Below 50", desc: "filler", min: -Infinity, max: 50, color: "bg-red-400" },
];

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 text-foreground-muted">
        <span className="w-8 h-8 rounded-lg bg-accent-glow flex items-center justify-center text-accent flex-shrink-0">
          {icon}
        </span>
        <p className="text-[13px] font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="font-geist text-3xl sm:text-4xl font-bold text-white mt-3 tabular-nums">{value}</p>
      <p className="text-sm text-foreground-muted mt-1">{sub}</p>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-geist text-lg font-bold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const icons = {
  clips: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  score: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15 9 22 9 16 13 18 20 12 16 6 20 8 13 2 9 9 9" />
    </svg>
  ),
  trophy: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  ),
  streams: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
};

export default function AnalyticsPage() {
  const [allClips, setAllClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("all"); // default: All time
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { exports, createClip, invalidateClip } = useClipExports();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setAllClips(data ?? []);
        setLoading(false);
      });
  }, []);

  /** Every panel reads from this, so the filter genuinely applies page-wide. */
  const clips = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)?.days ?? null;
    if (days === null) return allClips;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return allClips.filter((c) => new Date(c.created_at).getTime() >= cutoff);
  }, [allClips, period]);

  const stats = useMemo(() => {
    if (clips.length === 0) return null;

    const total = clips.length;
    const avgScore = Math.round(clips.reduce((s, c) => s + c.viral_score, 0) / total);
    const topRated = clips.filter((c) => c.viral_score >= 85).length;
    const sources = new Set(clips.map((c) => c.url)).size;
    const minutes = Math.round(clips.reduce((s, c) => s + clipDuration(c), 0) / 60);

    const counts: Record<string, number> = {};
    for (const c of clips) counts[c.clip_type] = (counts[c.clip_type] ?? 0) + 1;
    // Sorted by count, as asked — not the fixed CLIP_TYPE_ORDER.
    const types = Object.entries(counts)
      .map(([type, count]) => ({ type, count, pct: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);

    const bands = BANDS.map((b) => {
      const count = clips.filter((c) => c.viral_score >= b.min && c.viral_score < b.max).length;
      return { ...b, count, pct: (count / total) * 100 };
    });

    const topClips = [...clips].sort((a, b) => b.viral_score - a.viral_score).slice(0, 3);

    /**
     * Weekly buckets ending at the most recent clip in range, not at today —
     * with months of silence the chart would otherwise be eight empty columns.
     * Every column is labelled with its real week-start date, so the window is
     * never mistaken for "this week".
     */
    const newest = clips.reduce(
      (max, c) => Math.max(max, new Date(c.created_at).getTime()),
      0
    );
    const anchor = new Date(newest);
    anchor.setDate(anchor.getDate() - anchor.getDay()); // back to Sunday
    anchor.setHours(0, 0, 0, 0);

    const weeks: { label: string; count: number }[] = [];
    for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      weeks.push({
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        count: clips.filter((c) => {
          const t = new Date(c.created_at).getTime();
          return t >= start.getTime() && t < end.getTime();
        }).length,
      });
    }
    const maxWeek = Math.max(1, ...weeks.map((w) => w.count));

    return { total, avgScore, topRated, sources, minutes, types, bands, topClips, weeks, maxWeek };
  }, [clips]);

  const previewClip = useMemo(
    () => clips.find((c) => c.id === previewId) ?? null,
    [clips, previewId]
  );

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-5 animate-fade-in font-geist">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="font-geist text-3xl sm:text-4xl font-bold text-white">Analytics</h1>
          <p className="text-[15px] text-foreground-muted mt-1">
            Your clipping activity at a glance.
          </p>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden self-start">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={`px-3 sm:px-4 py-2 text-[13px] font-bold transition-colors ${
                period === p.key
                  ? "bg-accent-glow text-accent"
                  : "bg-surface text-foreground-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : !stats ? (
        <div className="bg-surface border border-border rounded-xl py-20 text-center">
          <p className="font-geist text-lg font-semibold text-white">
            {allClips.length === 0 ? "No clips yet" : `No clips in the ${periodLabel.toLowerCase()}`}
          </p>
          <p className="text-[15px] text-foreground-muted mt-2 max-w-md mx-auto">
            {allClips.length === 0
              ? "Analyze a VOD and your stats will appear here."
              : `You have ${allClips.length} clip${allClips.length === 1 ? "" : "s"} in total — switch to All time to see them.`}
          </p>
          {allClips.length === 0 && (
            <Link
              href="/dashboard"
              className="inline-block mt-5 px-5 py-2.5 rounded-lg bg-accent text-background text-sm font-bold hover:bg-accent-dim transition-colors"
            >
              Analyze a VOD
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* ── Stat cards ── */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Total clips" value={String(stats.total)} sub={periodLabel.toLowerCase()} icon={icons.clips} />
            <StatCard label="Average AI score" value={String(stats.avgScore)} sub="out of 100 — estimate" icon={icons.score} />
            <StatCard label="Top-rated clips" value={String(stats.topRated)} sub="scored 85 or above" icon={icons.trophy} />
            <StatCard label="VODs analyzed" value={String(stats.sources)} sub={`${stats.minutes} clip minutes`} icon={icons.streams} />
          </section>

          <p className="text-[13px] text-foreground-muted -mt-1">
            AI score is Klyp&apos;s own estimate of a clip&apos;s viral potential, made when the clip
            was found. It is not a measurement of how the clip performed.
          </p>

          {/* ── Clip types + score distribution ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel
              title="Clip types"
              action={
                stats.types.length > TYPES_COLLAPSED ? (
                  <button
                    onClick={() => setShowAllTypes((v) => !v)}
                    className="text-[13px] font-semibold text-foreground-muted hover:text-accent transition-colors"
                  >
                    {showAllTypes ? "Show less" : `Show all (${stats.types.length})`}
                  </button>
                ) : null
              }
            >
              <div className="space-y-2.5">
                {(showAllTypes ? stats.types : stats.types.slice(0, TYPES_COLLAPSED)).map((t) => (
                  <div key={t.type} className="flex items-center gap-3">
                    <span className={`w-28 flex-shrink-0 px-2 py-0.5 rounded border text-[11px] font-bold tracking-wide text-center ${TYPE_STYLES[t.type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                      {t.type}
                    </span>
                    {/* Track is the full width; fill is the share of all clips,
                        so 50% genuinely fills half. */}
                    <div className="flex-1 h-2.5 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${TYPE_BAR_COLORS[t.type] ?? "bg-accent"}`}
                        style={{ width: `${t.pct}%` }}
                      />
                    </div>
                    <span className="w-20 flex-shrink-0 text-right text-sm text-foreground-muted tabular-nums">
                      {t.count} ({Math.round(t.pct)}%)
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="AI score distribution">
              <div className="space-y-2.5">
                {stats.bands.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-28 flex-shrink-0 text-sm text-foreground">
                      {b.label} <span className="text-foreground-muted">({b.desc})</span>
                    </span>
                    <div className="flex-1 h-2.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className={`h-full rounded-full ${b.color}`} style={{ width: `${b.pct}%` }} />
                    </div>
                    <span className="w-20 flex-shrink-0 text-right text-sm text-foreground-muted tabular-nums">
                      {b.count} ({Math.round(b.pct)}%)
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Top-rated clips ── */}
          <Panel
            title="Top-rated clips"
            action={
              <Link
                href="/dashboard/clips"
                className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground-muted hover:text-accent transition-colors"
              >
                View all clips
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.topClips.map((clip, i) => (
                <div key={clip.id} className="flex flex-col">
                  <div className="relative">
                    <ClipThumbnail clip={clip} onPlay={() => setPreviewId(clip.id)} />
                    <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/80 border border-white/20 flex items-center justify-center text-white text-[11px] font-bold tabular-nums">
                      {i + 1}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3">
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold tracking-wide ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                      {clip.clip_type}
                    </span>
                    <span
                      title="Klyp's estimated viral potential"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent-glow border border-accent/30 text-accent text-[13px] font-bold tabular-nums"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15 9 22 9 16 13 18 20 12 16 6 20 8 13 2 9 9 9" />
                      </svg>
                      {clip.viral_score}
                    </span>
                  </div>
                  <p className="text-[15px] font-semibold text-white mt-2 line-clamp-2">{clip.title}</p>
                  <p className="text-sm text-foreground-muted font-mono mt-1">
                    {fmtTime(clip.start_seconds)} – {fmtTime(clip.end_seconds)}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── Weekly output ── */}
          <Panel title="Clips generated per week">
            <div className="flex items-end gap-2 sm:gap-3 h-36">
              {stats.weeks.map((w) => (
                <div key={w.label} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
                  <span className="text-[13px] text-foreground-muted tabular-nums">{w.count}</span>
                  <div
                    className="w-full rounded-t bg-accent/70 min-h-[2px] transition-[height]"
                    style={{ height: `${(w.count / stats.maxWeek) * 100}%` }}
                  />
                  <span className="text-[11px] text-foreground-muted tabular-nums">{w.label}</span>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-foreground-muted mt-3">
              Eight weeks up to your most recent clip, by the date each clip was created.
            </p>
          </Panel>
        </>
      )}

      {previewClip && (
        <ClipPreviewModal
          key={previewClip.id}
          clip={previewClip}
          onClipSaved={(draft) => {
            invalidateClip(previewClip.id);
            setAllClips((previous) => previous.map((item) =>
              item.id === previewClip.id ? { ...item, edit_draft: draft } : item));
          }}
          onClose={() => setPreviewId(null)}
          exportState={exports[previewClip.id]}
          onCreateClip={() => { createClip(previewClip); }}
          onDownloadClip={() => {
            const done = exports[previewClip.id];
            if (done) downloadExport(done, previewClip.id);
          }}
        />
      )}
    </div>
  );
}
