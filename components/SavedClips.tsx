"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface SavedClip {
  id: string;
  url: string;
  title: string;
  clip_type: string;
  viral_score: number;
  caption: string | null;
  start_seconds: number;
  end_seconds: number;
  created_at: string;
}

const TYPE_STYLES: Record<string, string> = {
  CLUTCH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FUNNY: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  RAGE: "bg-red-500/15 text-red-400 border-red-500/30",
  UNHINGED: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  HIGHLIGHT: "bg-accent-glow text-accent border-accent/30",
};

function fmtTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function shortDomain(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("twitch")) return "Twitch";
    if (u.hostname.includes("youtube") || u.hostname.includes("youtu.be")) return "YouTube";
    return u.hostname.replace("www.", "");
  } catch {
    return "VOD";
  }
}

export default function SavedClips() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setLoggedIn(false);
        setLoading(false);
        return;
      }
      setLoggedIn(true);
      const { data: rows } = await supabase
        .from("clips")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setClips(rows ?? []);
      setLoading(false);
    });
  }, []);

  const deleteClip = async (id: string) => {
    setDeletingId(id);
    const supabase = createClient();
    await supabase.from("clips").delete().eq("id", id);
    setClips((prev) => prev.filter((c) => c.id !== id));
    setDeletingId(null);
  };

  if (!loggedIn && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-accent-glow flex items-center justify-center mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <p className="text-sm text-foreground-muted">Sign in to save and view your clips.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-accent-glow flex items-center justify-center mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <p className="text-sm text-foreground-muted">No clips yet.</p>
        <p className="text-xs text-foreground-muted mt-1">Analyze a VOD above to generate clips.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {clips.map((clip) => {
        const typeStyle = TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT;
        const duration = Math.round(clip.end_seconds - clip.start_seconds);
        return (
          <div
            key={clip.id}
            className="flex items-start gap-3 p-4 rounded-xl bg-surface-2 border border-border hover:border-accent/20 transition-colors group"
          >
            {/* Left: type badge */}
            <span
              className={`mt-0.5 px-2 py-0.5 rounded border text-[10px] font-bold font-syne tracking-wide flex-shrink-0 ${typeStyle}`}
            >
              {clip.clip_type}
            </span>

            {/* Center: info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{clip.title}</p>
              <p className="text-xs text-foreground-muted truncate mt-0.5">
                {clip.caption}
              </p>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-subtle flex-wrap">
                <span className="font-mono">
                  {fmtTime(clip.start_seconds)} → {fmtTime(clip.end_seconds)}
                </span>
                <span>·</span>
                <span>{duration}s</span>
                <span>·</span>
                <span>{shortDomain(clip.url)}</span>
              </div>
            </div>

            {/* Right: score + delete */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`font-syne text-base font-bold ${
                  clip.viral_score >= 85 ? "text-accent" : "text-foreground-muted"
                }`}
              >
                {clip.viral_score}
              </span>
              <button
                onClick={() => deleteClip(clip.id)}
                disabled={deletingId === clip.id}
                title="Delete clip"
                className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded text-foreground-muted hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30"
              >
                {deletingId === clip.id ? (
                  <span className="w-3 h-3 rounded-full border border-foreground-muted border-t-transparent animate-spin" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
