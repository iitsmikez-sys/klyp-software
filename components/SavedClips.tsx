"use client";

/**
 * The dashboard's Saved Clips strip — the most recent clips as poster cards,
 * three across on desktop.
 *
 * Shares the My Clips machinery rather than reimplementing it: ClipThumbnail
 * for the per-clip frame, ClipPreviewModal for playback, and useClipExports so
 * an export started here survives closing the dialog and shows the same
 * Create/Download state the My Clips page would.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ClipThumbnail from "./ClipThumbnail";
import ClipPreviewModal from "./ClipPreviewModal";
import { useClipExports } from "./useClipExports";
import { downloadExport } from "@/lib/clip-export";
import { type SavedClip, TYPE_STYLES, fmtTime, footageGone, platformName } from "@/lib/clip-ui";
import { readClipEditDraft } from "@/lib/clip-edit-draft";

/** Enough to fill the row on every breakpoint without a second row. */
const LIMIT = 3;

export default function SavedClips() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { exports, createClip, createOrDownload, invalidateClip } = useClipExports();

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
        .limit(LIMIT);
      setClips(rows ?? []);
      setLoading(false);
    });
  }, []);

  const previewClip = useMemo(
    () => clips.find((c) => c.id === previewId) ?? null,
    [clips, previewId]
  );

  const flash = (msg: string | null | undefined) => {
    if (!msg) return;
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const heading = (
    <div className="flex items-center justify-between gap-4 mb-4">
      <h2 className="font-geist text-xl font-bold text-white">Saved Clips</h2>
      <Link
        href="/dashboard/clips"
        className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground-muted hover:text-accent transition-colors"
      >
        View all clips
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </Link>
    </div>
  );

  if (!loading && !loggedIn) {
    return (
      <section>
        {heading}
        <div className="bg-surface border border-border rounded-xl py-12 text-center">
          <p className="text-[15px] text-foreground-muted">Sign in to save and view your clips.</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section>
        {heading}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: LIMIT }).map((_, i) => (
            <div key={i} className={`rounded-xl border border-border bg-surface/50 p-3 ${i > 0 ? "hidden sm:block" : ""}`}>
              <div className="aspect-video w-full rounded-lg bg-surface-2 animate-pulse" />
              <div className="h-4 w-24 rounded bg-surface-2 animate-pulse mt-3" />
              <div className="h-5 w-full rounded bg-surface-2 animate-pulse mt-2" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (clips.length === 0) {
    return (
      <section>
        {heading}
        <div className="flex flex-col items-center justify-center bg-surface border border-border rounded-xl py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-accent-glow flex items-center justify-center mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <p className="text-base text-foreground">No clips yet.</p>
          <p className="text-[15px] text-foreground-muted mt-1">
            Analyze a VOD above and your clips will land here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      {heading}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clips.map((clip) => {
          const state = exports[clip.id];
          const draft = readClipEditDraft(clip).draft;
          const gone = footageGone(clip);
          return (
            <div
              key={clip.id}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-3 transition-colors hover:border-subtle"
            >
              <ClipThumbnail clip={clip} onPlay={() => { if (!gone) setPreviewId(clip.id); }} />

              <div className="mt-3 flex items-center gap-2">
                <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                  {clip.clip_type.replaceAll("_", " ")}
                </span>
              </div>
              <h3 className="mt-2 min-h-12 line-clamp-2 font-geist text-base font-semibold leading-6 text-white" title={draft.title}>
                {draft.title}
              </h3>
              <p className="mt-1 text-xs text-foreground-muted">
                {platformName(clip.url)} <span aria-hidden="true">·</span> {fmtTime(draft.end_seconds - draft.start_seconds)} clip <span aria-hidden="true">·</span> VOD {fmtTime(draft.start_seconds)}–{fmtTime(draft.end_seconds)}
              </p>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
                <Link href={`/dashboard/clips/${clip.id}/edit`} className="flex min-h-10 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-background hover:bg-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  Edit clip
                </Link>
                <button
                  type="button"
                  onClick={() => createOrDownload(clip).then(flash)}
                  disabled={state?.status === "working" || gone}
                  title={gone ? "The source VOD was deleted before this clip was backed up, so there is no footage to render" : undefined}
                  className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:border-subtle disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {gone ? "Footage gone" : state?.status === "working" ? "Creating…" : state?.status === "ready" ? "Download" : "Create clip"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

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
          onClose={() => setPreviewId(null)}
          exportState={exports[previewClip.id]}
          onCreateClip={() => { createClip(previewClip).then(flash); }}
          onDownloadClip={() => {
            const done = exports[previewClip.id];
            if (done) downloadExport(done, previewClip.id);
          }}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-surface border border-red-500/40 text-sm text-red-400 shadow-lg">
          {notice}
        </div>
      )}
    </section>
  );
}
