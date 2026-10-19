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
import { type SavedClip, TYPE_STYLES, fmtTime } from "@/lib/clip-ui";

/** Enough to fill the row on every breakpoint without a second row. */
const LIMIT = 3;

export default function SavedClips() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { exports, createClip, createOrDownload } = useClipExports();

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
            <div key={i} className="bg-surface border border-border rounded-xl p-3">
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
          return (
            <div
              key={clip.id}
              className="bg-surface border border-border rounded-xl p-3 flex flex-col hover:border-accent/30 transition-colors"
            >
              <ClipThumbnail clip={clip} onPlay={() => setPreviewId(clip.id)} />

              <div className="flex items-center justify-between gap-2 mt-3">
                <span className={`px-2 py-0.5 rounded border text-[11px] font-bold font-syne tracking-wide ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                  {clip.clip_type}
                </span>
                <button
                  onClick={() => createOrDownload(clip).then(flash)}
                  disabled={state?.status === "working"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-background text-[13px] font-bold hover:bg-accent-dim transition-colors disabled:opacity-60"
                >
                  {state?.status === "working" ? (
                    <>
                      <span className="w-3 h-3 rounded-full border-2 border-background border-t-transparent animate-spin" />
                      Creating…
                    </>
                  ) : state?.status === "ready" ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                        <line x1="14.47" y1="14.48" x2="20" y2="20" />
                        <line x1="8.12" y1="8.12" x2="12" y2="12" />
                      </svg>
                      Create clip
                    </>
                  )}
                </button>
              </div>

              <p className="font-geist text-base font-semibold text-white mt-2 line-clamp-2">
                {clip.title}
              </p>
              <p className="text-sm text-foreground-muted font-mono mt-1">
                {fmtTime(clip.start_seconds)} – {fmtTime(clip.end_seconds)}
              </p>
            </div>
          );
        })}
      </div>

      {previewClip && (
        <ClipPreviewModal
          clip={previewClip}
          onClose={() => setPreviewId(null)}
          exportState={exports[previewClip.id]}
          onCreateClip={() => { createClip(previewClip).then(flash); }}
          onDownloadClip={() => {
            const done = exports[previewClip.id];
            if (done) downloadExport(done);
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
