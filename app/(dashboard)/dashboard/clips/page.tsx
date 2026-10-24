"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ClipThumbnail from "@/components/ClipThumbnail";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import ClipPreviewModal from "@/components/ClipPreviewModal";
import ProGateModal from "@/components/ProGateModal";
import { useSparks } from "@/components/SparksProvider";
import { UPSCALE_COST } from "@/lib/sparks";
import { processingFetch } from "@/lib/processing-api";
import { downloadExport } from "@/lib/clip-export";
import { useClipExports } from "@/components/useClipExports";
import { getStoredHandle } from "@/lib/streamer-handle";
import {
  type SavedClip,
  TYPE_STYLES,
  CLIP_TYPE_ORDER,
  fmtTime,
  fmtDate,
  platformName,
  vodLinkAt,
  footageGone,
  scoreBand,
} from "@/lib/clip-ui";

type SortKey = "newest" | "score";

type ClipAction = {
  icon: string;
  label: string;
  pro: boolean;
  /** Extra right-side hint, e.g. the upscale Sparks cost. */
  hint?: string;
  run: (clip: SavedClip) => void;
};

/**
 * Reads ?vod= via useSearchParams, which opts the route out of static
 * prerendering unless it sits inside a Suspense boundary — see the default
 * export below.
 */
function ClipsPageContent() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  /** ?vod=<source url> — set by "View clips" on the Streams page. */
  const searchParams = useSearchParams();
  const vodFilter = searchParams.get("vod");
  const [sort, setSort] = useState<SortKey>("newest");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Clip shown in the centred preview dialog — the grid behind is untouched. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** Open the dialog straight to Details — the ⋯ menu's editing actions live there. */
  const [previewDetails, setPreviewDetails] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [proGateOpen, setProGateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, "approved" | "rejected">>({});


  const { tier, refresh } = useSparks();
  // Shared with the dashboard's Saved Clips so both behave identically.
  const { exports, workingId, createClip } = useClipExports(refresh);
  const isPro = tier === "pro";

  useEffect(() => {
    const supabase = createClient();
    supabase.from("clip_feedback").select("clip_id,verdict").then(({ data }) => {
      setVerdicts(Object.fromEntries((data ?? []).filter((row) => row.verdict === "approved" || row.verdict === "rejected")
        .map((row) => [row.clip_id, row.verdict as "approved" | "rejected"])));
    });
    supabase
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setClips(data ?? []);
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

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const rateClip = async (id: string, verdict: "approved" | "rejected") => {
    const { error } = await createClient().rpc("record_clip_feedback", { p_clip_id: id, p_signal: verdict });
    if (error) { flash("Could not save your feedback."); return; }
    setVerdicts((previous) => ({ ...previous, [id]: verdict }));
  };

  /** Render + download a clip with sensible defaults (BOLD captions if saved). */
  const duplicateClip = async (clip: SavedClip) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const base = {
      user_id: user.id,
      url: clip.url,
      title: `${clip.title} (copy)`,
      clip_type: clip.clip_type,
      viral_score: clip.viral_score,
      caption: clip.caption,
      reason: clip.reason,
      start_seconds: clip.start_seconds,
      end_seconds: clip.end_seconds,
    };
    let { data, error } = await supabase
      .from("clips")
      .insert({ ...base, hooks: clip.hooks ?? null, words: clip.words ?? null })
      .select()
      .single();
    if (error) {
      // hooks/words columns may not exist yet (migration 003)
      ({ data, error } = await supabase.from("clips").insert(base).select().single());
    }
    if (error || !data) {
      flash("Couldn't duplicate the clip.");
      return;
    }
    setClips((prev) => [data as SavedClip, ...prev]);
    flash("Clip duplicated.");
  };

  /** The ⋯ menu. Pro-gated actions swap to the upgrade modal for free users. */
  const clipActions: ClipAction[] = [
    {
      icon: "📤", label: "Publish on Social", pro: true, hint: "TikTok",
      run: () => flash("TikTok publishing is coming soon."),
    },
    {
      icon: "⬇️", label: "Download HD", pro: false,
      run: (clip) => { createClip(clip).then((err) => err && flash(err)); },
    },
    {
      icon: "⬆️", label: "Upscale & Download", pro: true, hint: `${UPSCALE_COST}⚡`,
      run: (clip) => { createClip(clip, true).then((err) => err && flash(err)); },
    },
    {
      icon: "✂️", label: "Open editor", pro: false,
      run: (clip) => { setPreviewId(clip.id); setPreviewDetails(true); },
    },
    {
      icon: "🎤", label: "AI Hook", pro: true,
      run: (clip) => { setPreviewId(clip.id); setPreviewDetails(true); },
    },
    {
      icon: "📐", label: "Export Formats", pro: true,
      run: (clip) => { setPreviewId(clip.id); setPreviewDetails(true); },
    },
    {
      icon: "🗑️", label: "Remove Watermark", pro: true,
      run: () => flash("You're on Pro — exports have no watermark."),
    },
    {
      icon: "📋", label: "Duplicate", pro: false,
      run: (clip) => { duplicateClip(clip); },
    },
  ];

  const runAction = (action: ClipAction, clip: SavedClip) => {
    setMenuOpenId(null);
    if (action.pro && !isPro) {
      setProGateOpen(true);
      return;
    }
    action.run(clip);
  };

  const filtered = useMemo(() => {
    let list = clips;
    if (vodFilter) list = list.filter((c) => c.url === vodFilter);
    if (typeFilter) list = list.filter((c) => c.clip_type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.caption ?? "").toLowerCase().includes(q)
      );
    }
    if (sort === "score") {
      list = [...list].sort((a, b) => b.viral_score - a.viral_score);
    }
    return list;
  }, [clips, typeFilter, search, sort, vodFilter]);

  const previewClip = useMemo(
    () => clips.find((c) => c.id === previewId) ?? null,
    [clips, previewId]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of clips) counts[c.clip_type] = (counts[c.clip_type] ?? 0) + 1;
    return counts;
  }, [clips]);

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      <header className="mb-8">
        <h1 className="font-syne text-3xl font-bold text-foreground">Found Moments</h1>
        <p className="text-foreground-muted mt-1 text-sm">
          {clips.length} moment{clips.length === 1 ? "" : "s"} found for you.
        </p>
      </header>

      {vodFilter && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-lg bg-accent-glow border border-accent/30">
          <span className="text-sm text-foreground">
            Showing clips from one VOD — {filtered.length} of {clips.length}.
          </span>
          <Link href="/dashboard/clips" className="text-sm font-bold text-accent hover:underline">
            Show all clips
          </Link>
        </div>
      )}

      {/* Toolbar: search + sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles and captions…"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            ["newest", "Newest"],
            ["score", "Top score"],
          ] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`px-4 py-2.5 text-xs font-bold font-syne transition-colors ${
                sort === key
                  ? "bg-accent-glow text-accent"
                  : "bg-surface text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-3 py-1.5 rounded-full border text-[11px] font-bold font-syne tracking-wide transition-colors ${
            typeFilter === null
              ? "bg-accent text-background border-accent"
              : "bg-surface text-foreground-muted border-border hover:border-subtle"
          }`}
        >
          ALL · {clips.length}
        </button>
        {CLIP_TYPE_ORDER.filter((t) => typeCounts[t]).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`px-3 py-1.5 rounded-full border text-[11px] font-bold font-syne tracking-wide transition-colors ${
              typeFilter === t ? TYPE_STYLES[t] : "bg-surface text-foreground-muted border-border hover:border-subtle"
            }`}
          >
            {t} · {typeCounts[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-surface border border-border rounded-2xl">
          <div className="w-14 h-14 rounded-full bg-accent-glow flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <p className="font-syne font-semibold text-foreground">
            {clips.length === 0 ? "No moments yet" : "Nothing matches your filters"}
          </p>
          <p className="text-sm text-foreground-muted mt-1 mb-5">
            {clips.length === 0
              ? "Analyze a VOD and your moments will land here."
              : "Try clearing the search or type filter."}
          </p>
          {clips.length === 0 && (
            <Link
              href="/dashboard"
              className="px-5 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
            >
              Analyze a VOD
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((clip) => (
            <div
              key={clip.id}
              onClick={() => {
                // A clip with no footage left has nothing to show in the
                // dialog, so the card opens its details rather than a player.
                setPreviewId(clip.id);
                setPreviewDetails(footageGone(clip));
              }}
              className="bg-surface border border-border rounded-xl p-4 flex flex-col transition-colors group cursor-pointer hover:border-accent/30"
            >
              {/* 16:9 poster — play opens the centred preview dialog. */}
              <div className="mb-3">
                <ClipThumbnail clip={clip} onPlay={() => { setPreviewId(clip.id); setPreviewDetails(false); }} />
              </div>

              <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-2.5 py-1 rounded-md border text-[11px] font-bold font-syne tracking-wide ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                    {clip.clip_type}
                  </span>
                  {clip.archive_status === "stored" && <span className="text-[11px] text-accent" title="A copy is saved in Klyp">Footage saved</span>}
                  {(clip.archive_status === "pending" || clip.archive_status === "processing") &&
                    <span className="text-[11px] text-foreground-muted">Saving footage…</span>}
                  {clip.archive_status === "failed" && <span className="text-[11px] text-amber-400">Footage not backed up</span>}
                </div>
                <div className="flex items-center gap-2">
                  {/* The band, not the bare number, is the honest headline:
                      analysis never returns anything under 65, so a raw score
                      read as a percentage understates every clip. */}
                  <span
                    title={`${scoreBand(clip.viral_score).blurb} Score ${clip.viral_score} of a 65-100 range.`}
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-bold font-syne tracking-wide ${scoreBand(clip.viral_score).className}`}
                  >
                    {scoreBand(clip.viral_score).label}
                  </span>
                  <span className={`font-syne text-xl font-bold ${clip.viral_score >= 85 ? "text-accent" : "text-foreground"}`}>
                    {clip.viral_score}
                  </span>
                  {/* ⋯ actions menu */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === clip.id ? null : clip.id);
                      }}
                      title="Clip actions"
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-border text-foreground-muted hover:text-foreground hover:border-subtle transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </button>

                    {menuOpenId === clip.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-9 z-30 w-60 py-1.5 rounded-xl bg-surface border border-border shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]"
                      >
                        {clipActions.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => runAction(action, clip)}
                            disabled={workingId === clip.id}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
                          >
                            <span className="text-sm leading-none">{action.icon}</span>
                            <span className="flex-1">{action.label}</span>
                            {action.hint && (
                              <span className="text-[10px] text-subtle">{action.hint}</span>
                            )}
                            {action.pro && (
                              <span className="px-1.5 py-0.5 rounded bg-accent-glow text-accent text-[9px] font-bold font-syne tracking-wide">
                                PRO
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <h3 className="font-syne text-lg font-bold text-white leading-snug mb-1.5">{clip.title}</h3>
              <div className="flex items-center gap-2 mb-2 text-xs text-foreground-muted" onClick={(e) => e.stopPropagation()}>
                <span>Useful moment?</span>
                <button type="button" aria-label="Keep this kind of moment" aria-pressed={verdicts[clip.id] === "approved"}
                  onClick={() => rateClip(clip.id, "approved")}
                  className={`rounded-md border px-2 py-1 ${verdicts[clip.id] === "approved" ? "border-accent text-accent" : "border-border hover:text-accent"}`}>👍 Keep</button>
                <button type="button" aria-label="Show fewer moments like this" aria-pressed={verdicts[clip.id] === "rejected"}
                  onClick={() => rateClip(clip.id, "rejected")}
                  className={`rounded-md border px-2 py-1 ${verdicts[clip.id] === "rejected" ? "border-amber-400 text-amber-400" : "border-border hover:text-amber-400"}`}>👎 Less like this</button>
              </div>
              {clip.caption && (
                <p className="text-[15px] leading-relaxed text-foreground-muted mb-3 line-clamp-2">
                  {clip.caption}
                </p>
              )}

              {/* Push the action row to the bottom so buttons line up across the grid. */}
              <div className="flex items-center justify-between gap-2 text-sm mb-3 mt-auto">
                <span className="px-2 py-1 rounded bg-surface-2 border border-border text-foreground-muted font-mono whitespace-nowrap">
                  {fmtTime(clip.start_seconds)} → {fmtTime(clip.end_seconds)}
                </span>
                <span className="text-foreground-muted whitespace-nowrap truncate">
                  {platformName(clip.url)} · {fmtDate(clip.created_at)}
                </span>
              </div>

              {/* What the score is actually made of. Renders nothing for
                  clips saved before the breakdown was stored. */}
              <div className="mt-2.5">
                <ScoreBreakdown clip={clip} />
              </div>

              {/* Wraps on narrow cards: primary takes its own row, secondary
                  shares the next one with delete — no squashed labels. */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
                {/* Open the existing editor with its controls expanded. The
                    final create action stays inside the dialog. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewId(clip.id);
                    setPreviewDetails(true);
                  }}
                  disabled={footageGone(clip)}
                  title={footageGone(clip)
                    ? "The source VOD was deleted before this clip was backed up, so there is no footage to render"
                    : "Open the clip editor"}
                  className={`basis-full sm:basis-0 sm:flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold font-syne transition-colors disabled:opacity-60 disabled:shadow-none ${
                    // Neutral, not the accent: a bright primary button reads as
                    // something to press, and there is nothing to press here.
                    footageGone(clip)
                      ? "bg-surface-2 text-muted border border-border cursor-not-allowed"
                      : "bg-accent text-background hover:bg-accent-dim shadow-accent-glow-sm"
                  }`}
                >
                  {footageGone(clip) ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
                      </svg>
                      Footage gone
                    </>
                  ) : (
                    <>
                      {/* scissors */}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                        <line x1="14.47" y1="14.48" x2="20" y2="20" />
                        <line x1="8.12" y1="8.12" x2="12" y2="12" />
                      </svg>
                      Open editor
                    </>
                  )}
                </button>
                {clip.url.startsWith("upload:") ? (
                  <span className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-border text-foreground-muted text-sm font-bold font-syne whitespace-nowrap">
                    Uploaded VOD
                  </span>
                ) : (
                <a
                  href={vodLinkAt(clip.url, clip.start_seconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-accent/40 text-accent text-sm font-bold font-syne whitespace-nowrap hover:bg-accent-glow transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Watch on {platformName(clip.url)}
                </a>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteClip(clip.id); }}
                  disabled={deletingId === clip.id}
                  title="Delete clip"
                  className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-border text-foreground-muted hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                >
                  {deletingId === clip.id ? (
                    <span className="w-3 h-3 rounded-full border border-foreground-muted border-t-transparent animate-spin" />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  )}
                </button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Click-away closes the actions menu */}
      {menuOpenId && (
        <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} />
      )}

      {previewClip && (
        <ClipPreviewModal
          /* Remount per clip: a close animation still in flight for the
             previous clip must not fire into the next one. */
          key={previewClip.id}
          clip={previewClip}
          onClose={() => { setPreviewId(null); setPreviewDetails(false); }}
          initialDetailsOpen={previewDetails}
          exportState={exports[previewClip.id]}
          onCreateClip={() => { createClip(previewClip).then((err) => err && flash(err)); }}
          onDownloadClip={() => {
            const done = exports[previewClip.id];
            if (done) downloadExport(done, previewClip.id);
          }}
        />
      )}

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-surface border border-accent/40 text-sm text-foreground shadow-accent-glow-sm animate-fade-in">
          {notice}
        </div>
      )}
    </div>
  );
}

export default function ClipsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      }
    >
      <ClipsPageContent />
    </Suspense>
  );
}
