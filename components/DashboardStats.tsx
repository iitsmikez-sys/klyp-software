"use client";

/**
 * The dashboard's four stat cards, computed from the signed-in user's own rows.
 *
 * Every figure here is real or absent — a stat whose source table isn't there
 * renders "—" with a reason rather than a plausible-looking number. Hours
 * processed in particular depends on public.transcripts (migration 006), which
 * is not applied on every environment.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Stat = {
  label: string;
  /** null while loading; a string once known. */
  value: string | null;
  sub: string;
  /** Set when the figure can't be computed at all. */
  unavailable?: string;
  icon: React.ReactNode;
};

const iconProps = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICONS = {
  clips: (
    <svg {...iconProps}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
  hours: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  score: (
    <svg {...iconProps}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  streams: (
    <svg {...iconProps}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
};

export default function DashboardStats() {
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setError("Sign in to see your stats.");
        return;
      }

      // Clips: counted and scored client-side — RLS already scopes these rows
      // to the signed-in user, and the volume is small.
      const clipsQuery = supabase.from("clips").select("viral_score,created_at");
      const streamsQuery = supabase.from("streams").select("id");
      // Missing on environments where migration 006 was never applied.
      const transcriptsQuery = supabase.from("transcripts").select("duration_seconds");

      const [clipsRes, streamsRes, transcriptsRes] = await Promise.all([
        clipsQuery,
        streamsQuery,
        transcriptsQuery,
      ]);
      if (cancelled) return;

      if (clipsRes.error) {
        setError("Couldn't load your stats.");
        return;
      }

      const clips = clipsRes.data ?? [];
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const thisMonth = clips.filter((c) => new Date(c.created_at) >= monthStart).length;

      const avgScore = clips.length
        ? Math.round(clips.reduce((sum, c) => sum + (c.viral_score ?? 0), 0) / clips.length)
        : null;

      const hours = transcriptsRes.error
        ? null
        : (transcriptsRes.data ?? []).reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0) / 3600;

      setStats([
        {
          label: "Clips generated",
          value: String(thisMonth),
          sub: "this month",
          icon: ICONS.clips,
        },
        {
          label: "Hours processed",
          value: hours === null ? "—" : hours.toFixed(1),
          sub: "total",
          unavailable: transcriptsRes.error ? "No transcript history stored yet" : undefined,
          icon: ICONS.hours,
        },
        {
          label: "Avg. clip score",
          value: avgScore === null ? "—" : String(avgScore),
          sub: avgScore === null ? "no clips yet" : "viral score",
          icon: ICONS.score,
        },
        {
          label: "Streams connected",
          value: streamsRes.error ? "—" : String((streamsRes.data ?? []).length),
          sub: "active",
          unavailable: streamsRes.error ? "Couldn't load connected streams" : undefined,
          icon: ICONS.streams,
        },
      ]);
    })().catch(() => {
      if (!cancelled) setError("Couldn't load your stats.");
    });

    return () => { cancelled = true; };
  }, []);

  const cards: Stat[] =
    stats ??
    (["Clips generated", "Hours processed", "Avg. clip score", "Streams connected"].map(
      (label, i) => ({
        label,
        value: null,
        sub: ["this month", "total", "viral score", "active"][i],
        icon: Object.values(ICONS)[i],
      })
    ) as Stat[]);

  return (
    <section className="grid grid-cols-2 gap-y-5 border-t border-border pt-5 lg:grid-cols-4" aria-label="Your activity">
      {cards.map((card) => (
        <div key={card.label} className="min-w-0 px-2 sm:px-4 first:pl-0 lg:border-r lg:border-border lg:last:border-r-0">
          <div className="flex items-center gap-2 text-foreground-muted">
            {card.icon}
            <p className="text-sm font-medium">{card.label}</p>
          </div>
          {error ? (
            <p className="mt-2 text-sm text-foreground-muted">{error}</p>
          ) : card.value === null ? (
            /* Loading — a bar the width of a typical figure, not a spinner per card. */
            <div className="mt-3 h-8 w-16 rounded bg-surface-2 animate-pulse" />
          ) : (
            <>
              <p className="mt-2 font-geist text-2xl font-semibold tabular-nums text-white">
                {card.value}
              </p>
              <p className="text-sm text-foreground-muted mt-1">
                {card.unavailable ?? card.sub}
              </p>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
