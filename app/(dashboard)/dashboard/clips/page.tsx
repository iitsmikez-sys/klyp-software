"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CompactClipCard from "@/components/CompactClipCard";
import { useRawClipDownloads } from "@/components/useRawClipDownloads";
import ClipPreviewModal from "@/components/ClipPreviewModal";
import { useSparks } from "@/components/SparksProvider";
import { downloadExport } from "@/lib/clip-export";
import { useClipExports } from "@/components/useClipExports";
import {
  type SavedClip,
  TYPE_STYLES,
  CLIP_TYPE_ORDER,
  fmtTime,
  footageGone,
} from "@/lib/clip-ui";
import { readClipEditDraft } from "@/lib/clip-edit-draft";

type SortKey = "newest" | "score";

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
  const [notice, setNotice] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, "approved" | "rejected">>({});


  const { refresh } = useSparks();
  // Shared with the dashboard's Saved Clips so both behave identically.
  const { exports, createClip, invalidateClip } = useClipExports(refresh);
  const { rawDownloads, downloadRaw } = useRawClipDownloads();

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

  const filtered = useMemo(() => {
    let list = clips;
    if (vodFilter) list = list.filter((c) => c.url === vodFilter);
    if (typeFilter) list = list.filter((c) => c.clip_type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          readClipEditDraft(c).draft.title.toLowerCase().includes(q) ||
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(clip => <CompactClipCard key={clip.id} clip={clip}
            onPreview={() => { setPreviewId(clip.id); setPreviewDetails(false); }}
            rawState={rawDownloads[clip.id]} onDownloadRaw={() => void downloadRaw(clip)}
            more={<div className="relative">
              <button type="button" aria-label={"More actions for " + clip.title} aria-expanded={menuOpenId === clip.id}
                onClick={() => setMenuOpenId(menuOpenId === clip.id ? null : clip.id)}
                className="rounded-md border border-border px-2 py-0.5 text-foreground-muted hover:text-foreground">•••</button>
              {menuOpenId === clip.id && <div className="absolute right-0 top-8 z-30 w-52 rounded-lg border border-border bg-surface p-1 shadow-xl">
                <button type="button" onClick={() => { setMenuOpenId(null); void rateClip(clip.id, "approved"); }}
                  className="block w-full rounded px-3 py-2 text-left text-xs text-foreground-muted hover:bg-surface-2">More moments like this{verdicts[clip.id] === "approved" ? " ✓" : ""}</button>
                <button type="button" onClick={() => { setMenuOpenId(null); void rateClip(clip.id, "rejected"); }}
                  className="block w-full rounded px-3 py-2 text-left text-xs text-foreground-muted hover:bg-surface-2">Fewer moments like this{verdicts[clip.id] === "rejected" ? " ✓" : ""}</button>
                <button type="button" onClick={() => { setMenuOpenId(null); void duplicateClip(clip); }}
                  className="block w-full rounded px-3 py-2 text-left text-xs text-foreground-muted hover:bg-surface-2">Duplicate</button>
                <button type="button" onClick={() => { setMenuOpenId(null); void deleteClip(clip.id); }}
                  disabled={deletingId === clip.id} className="block w-full rounded px-3 py-2 text-left text-xs text-red-400 hover:bg-surface-2">Delete</button>
              </div>}
            </div>} />)}
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
          onClipSaved={(draft) => {
            invalidateClip(previewClip.id);
            setClips((previous) => previous.map((item) =>
              item.id === previewClip.id ? { ...item, edit_draft: draft } : item));
          }}
          onClose={() => { setPreviewId(null); setPreviewDetails(false); }}
          initialDetailsOpen={previewDetails}
          exportState={exports[previewClip.id]}
          onCreateClip={() => { createClip(previewClip).then((err) => err && flash(err)); }}
          onDownloadClip={() => {
            const done = exports[previewClip.id];
            if (done) downloadExport(done);
          }}
          rawState={rawDownloads[previewClip.id]}
          onDownloadRaw={() => void downloadRaw(previewClip)}
        />
      )}


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
