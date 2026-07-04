"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  type SavedClip,
  TYPE_STYLES,
  TYPE_BAR_COLORS,
  CLIP_TYPE_ORDER,
  fmtDate,
  platformName,
} from "@/lib/clip-ui";

const WEEKS_SHOWN = 8;

export default function AnalyticsPage() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setClips(data ?? []);
        setLoading(false);
      });
  }, []);

  const stats = useMemo(() => {
    if (clips.length === 0) return null;

    const totalScore = clips.reduce((s, c) => s + c.viral_score, 0);
    const streams = new Set(clips.map((c) => c.url)).size;
    const bangers = clips.filter((c) => c.viral_score >= 85).length;
    const totalSeconds = clips.reduce((s, c) => s + (c.end_seconds - c.start_seconds), 0);

    const typeCounts: Record<string, number> = {};
    for (const c of clips) typeCounts[c.clip_type] = (typeCounts[c.clip_type] ?? 0) + 1;
    const maxTypeCount = Math.max(...Object.values(typeCounts));
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];

    // Score buckets: <50, 50-69, 70-84, 85+
    const buckets = [
      { label: "85+", desc: "banger", count: clips.filter((c) => c.viral_score >= 85).length, color: "bg-accent" },
      { label: "70–84", desc: "strong", count: clips.filter((c) => c.viral_score >= 70 && c.viral_score < 85).length, color: "bg-sky-400" },
      { label: "50–69", desc: "decent", count: clips.filter((c) => c.viral_score >= 50 && c.viral_score < 70).length, color: "bg-amber-400" },
      { label: "<50", desc: "filler", count: clips.filter((c) => c.viral_score < 50).length, color: "bg-red-400" },
    ];

    // Clips per week, last N weeks (oldest → newest)
    const now = new Date();
    const weeks: { label: string; count: number }[] = [];
    for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() - i * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      const count = clips.filter((c) => {
        const t = new Date(c.created_at);
        return t >= start && t < end;
      }).length;
      weeks.push({
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        count,
      });
    }
    const maxWeek = Math.max(1, ...weeks.map((w) => w.count));

    const topClips = [...clips].sort((a, b) => b.viral_score - a.viral_score).slice(0, 5);

    return {
      total: clips.length,
      avgScore: Math.round(totalScore / clips.length),
      streams,
      bangers,
      minutes: Math.round(totalSeconds / 60),
      typeCounts,
      maxTypeCount,
      topType,
      buckets,
      weeks,
      maxWeek,
      topClips,
    };
  }, [clips]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-8 max-w-6xl mx-auto animate-fade-in">
        <header className="mb-8">
          <h1 className="font-syne text-3xl font-bold text-foreground">Analytics</h1>
          <p className="text-foreground-muted mt-1 text-sm">Your clipping performance at a glance.</p>
        </header>
        <div className="flex flex-col items-center justify-center py-24 text-center bg-surface border border-border rounded-2xl">
          <div className="w-14 h-14 rounded-full bg-accent-glow flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </div>
          <p className="font-syne font-semibold text-foreground">No data yet</p>
          <p className="text-sm text-foreground-muted mt-1 mb-5">
            Analytics light up once you&apos;ve analyzed your first VOD.
          </p>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
          >
            Analyze a VOD
          </Link>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: "Total Clips", value: String(stats.total), sub: "all time" },
    { label: "Avg. Viral Score", value: String(stats.avgScore), sub: "out of 100" },
    { label: "Most Common Type", value: stats.topType, sub: `${stats.typeCounts[stats.topType]} clips` },
    { label: "Bangers (85+)", value: String(stats.bangers), sub: `${Math.round((stats.bangers / stats.total) * 100)}% of clips` },
    { label: "Streams Analyzed", value: String(stats.streams), sub: `${stats.minutes} clip minutes` },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      <header className="mb-8">
        <h1 className="font-syne text-3xl font-bold text-foreground">Analytics</h1>
        <p className="text-foreground-muted mt-1 text-sm">Your clipping performance at a glance.</p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5 mb-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-xs text-foreground-muted uppercase tracking-wider font-medium">{card.label}</p>
            <p className={`font-syne font-bold text-foreground mt-2 ${card.value.length > 5 ? "text-xl leading-8" : "text-3xl"}`}>{card.value}</p>
            <p className="text-xs text-foreground-muted mt-1">{card.sub}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Clip type distribution */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-5">Clip Types</h2>
          <div className="space-y-4">
            {CLIP_TYPE_ORDER.filter((t) => stats.typeCounts[t]).map((t) => {
              const count = stats.typeCounts[t];
              const pct = Math.round((count / stats.total) * 100);
              return (
                <div key={t}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-syne ${TYPE_STYLES[t]}`}>
                      {t}
                    </span>
                    <span className="text-xs text-foreground-muted">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${TYPE_BAR_COLORS[t]} transition-all duration-500`}
                      style={{ width: `${(count / stats.maxTypeCount) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Score quality breakdown */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-5">Score Quality</h2>
          <div className="space-y-4">
            {stats.buckets.map((b) => {
              const pct = stats.total ? Math.round((b.count / stats.total) * 100) : 0;
              return (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold font-syne text-foreground">
                      {b.label} <span className="font-normal text-foreground-muted">({b.desc})</span>
                    </span>
                    <span className="text-xs text-foreground-muted">{b.count} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${b.color} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly activity */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-5">
            Clips per Week <span className="text-xs font-normal text-foreground-muted">(last {WEEKS_SHOWN} weeks)</span>
          </h2>
          <div className="flex items-end gap-2 h-36">
            {stats.weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                {w.count > 0 && (
                  <span className="text-[10px] text-foreground-muted font-syne font-bold">{w.count}</span>
                )}
                <div
                  className={`w-full rounded-t ${w.count > 0 ? "bg-accent" : "bg-surface-2"} transition-all duration-500`}
                  style={{ height: `${Math.max(4, (w.count / stats.maxWeek) * 100)}%` }}
                />
                <span className="text-[9px] text-subtle">{w.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top clips leaderboard */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-4">Top Clips</h2>
          <div className="space-y-2.5">
            {stats.topClips.map((clip, i) => (
              <div key={clip.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-2 border border-border">
                <span className={`font-syne text-sm font-bold w-5 text-center flex-shrink-0 ${i === 0 ? "text-accent" : "text-foreground-muted"}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{clip.title}</p>
                  <p className="text-[10px] text-subtle">
                    {platformName(clip.url)} · {fmtDate(clip.created_at)}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded border text-[9px] font-bold font-syne flex-shrink-0 ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                  {clip.clip_type}
                </span>
                <span className={`font-syne text-base font-bold flex-shrink-0 ${clip.viral_score >= 85 ? "text-accent" : "text-foreground"}`}>
                  {clip.viral_score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
