"use client";

/**
 * Centred preview dialog for a saved clip, opened from a card's thumbnail or
 * play button. Replaces the old inline expansion, which reflowed the grid
 * (the card grew to span both columns and pushed everything below it).
 *
 * The player shows the clip at the source's own aspect ratio — /api/preview is
 * asked for crop:false, since cropping a 16:9 moment to vertical here would
 * hide most of the frame. The MP4 is already cut to the clip's range, so the
 * native control bar's elapsed/total time is clip-relative (00:12 / 00:45) and
 * playback stops at the clip's end on its own.
 *
 * Export state lives in the clips page, not here, so a render keeps running —
 * and stays visible on the card — when the dialog is closed mid-export.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import SavedClipEditor from "./SavedClipEditor";
import { processingFetch } from "@/lib/processing-api";
import {
  type SavedClip,
  TYPE_STYLES,
  fmtTime,
  fmtDate,
  platformName,
  vodLinkAt,
} from "@/lib/clip-ui";
import type { ExportState } from "@/lib/clip-export";

/** Give a first-time source-VOD download plenty of room, but fail loudly eventually. */
const PREVIEW_TIMEOUT_MS = 6 * 60_000;

interface Props {
  clip: SavedClip;
  onClose: () => void;
  /** Export progress for this clip, owned by the page so it survives closing. */
  exportState: ExportState | undefined;
  onCreateClip: () => void;
  onDownloadClip: () => void;
  /** Opened from an editing action in the card's ⋯ menu, which lives in Details. */
  initialDetailsOpen?: boolean;
}

function fmtElapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ClipPreviewModal({
  clip,
  onClose,
  exportState,
  onCreateClip,
  onDownloadClip,
  initialDetailsOpen = false,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);

  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* ── Escape to close, and a focus trap so Tab can't reach the grid behind ── */
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    // The page behind must not scroll while the dialog is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus?.();
    };
  }, [onClose]);

  /* ── Stop playback and audio the moment the dialog goes away ── */
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
        // Dropping the source stops any buffering audio too, not just playback.
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [previewUrl]);

  /* ── Fetch the cut preview (source aspect ratio, not the 9:16 export crop) ── */
  useEffect(() => {
    let blobUrl: string | null = null;
    let timedOut = false;
    setLoading(true);
    setLoadError(null);
    setElapsed(0);
    const startedAt = Date.now();
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, PREVIEW_TIMEOUT_MS);
    const settle = () => { clearInterval(ticker); clearTimeout(timeout); };

    processingFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: clip.url,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        crop: false,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d?.error ?? "Preview failed.")));
        return res.blob();
      })
      .then((blob) => {
        settle();
        blobUrl = URL.createObjectURL(blob);
        setPreviewUrl(blobUrl);
        setLoading(false);
      })
      .catch((err: Error) => {
        settle();
        if (controller.signal.aborted && !timedOut) return; // closed — leave state alone
        setLoadError(
          timedOut
            ? `Preview timed out after ${Math.round(PREVIEW_TIMEOUT_MS / 60_000)} minutes. The source VOD may still be downloading in the background — try again in a bit.`
            : err.message
        );
        setLoading(false);
      });

    return () => {
      settle();
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [clip.id, retryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBackdrop = useCallback(
    (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
    [onClose]
  );

  const platform = platformName(clip.url);
  const isUpload = clip.url.startsWith("upload:");
  const exporting = exportState?.status === "working";
  const ready = exportState?.status === "ready";

  return (
    <div
      onMouseDown={onBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-geist animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${clip.title}`}
        className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto scrollbar-thin rounded-2xl bg-surface border border-border shadow-[0_32px_80px_-16px_rgba(0,0,0,0.9)]"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            {/* Wraps rather than truncates — on a phone the tail of a title is
                often the point of it ("…Then THIS Happened"). */}
            <h2 className="font-geist text-xl sm:text-2xl font-bold text-white leading-tight line-clamp-2">
              {clip.title}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm text-foreground-muted">
              <span className={`px-2 py-0.5 rounded border text-[11px] font-bold tracking-wide ${TYPE_STYLES[clip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                {clip.clip_type}
              </span>
              <span className="text-subtle">•</span>
              <span>{isUpload ? "Uploaded VOD" : platform}</span>
              <span className="text-subtle">•</span>
              <span>{fmtDate(clip.created_at)}</span>
              <span className="text-subtle">•</span>
              <span className="font-mono text-[13px]">
                {fmtTime(clip.start_seconds)} → {fmtTime(clip.end_seconds)}
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close preview"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-foreground-muted hover:text-foreground hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Player ── object-contain keeps the source aspect ratio intact ── */}
        <div className="mx-6 rounded-xl bg-black border border-border overflow-hidden">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <span className="text-sm text-foreground-muted">
                  Generating preview…{elapsed >= 5 ? ` (${fmtElapsed(elapsed)})` : ""}
                  <br />
                  <span className="text-xs text-subtle">
                    {elapsed < 30
                      ? "Downloads the source video the first time."
                      : "Still downloading the source VOD — long VODs can take several minutes."}
                  </span>
                </span>
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
                <p className="text-sm text-red-400 text-center max-w-md">{loadError}</p>
                <button
                  onClick={() => setRetryToken((t) => t + 1)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-foreground-muted hover:text-foreground hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {previewUrl && (
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="px-6 pt-5 pb-2 flex flex-col sm:flex-row gap-3">
          {ready ? (
            <button
              onClick={onDownloadClip}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-background text-base font-bold hover:bg-accent-dim shadow-accent-glow-sm focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download clip
            </button>
          ) : (
            <button
              onClick={onCreateClip}
              disabled={exporting}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-background text-base font-bold hover:bg-accent-dim shadow-accent-glow-sm focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors disabled:opacity-60 disabled:shadow-none"
            >
              {exporting ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-background border-t-transparent animate-spin" />
                  Creating clip…
                </>
              ) : (
                <>
                  {/* scissors */}
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" />
                    <line x1="14.47" y1="14.48" x2="20" y2="20" />
                    <line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                  Create clip
                </>
              )}
            </button>
          )}

          {isUpload ? (
            <span className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-foreground-muted text-base font-bold">
              Uploaded VOD
            </span>
          ) : (
            <a
              href={vodLinkAt(clip.url, clip.start_seconds)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-accent/40 text-accent text-base font-bold hover:bg-accent-glow focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Watch on {platform}
            </a>
          )}
        </div>

        {exportState?.status === "error" && (
          <p className="mx-6 mt-1 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {exportState.error}{" "}
            <button onClick={onCreateClip} className="underline font-semibold hover:text-red-300">
              Try again
            </button>
          </p>
        )}

        {/* ── Details: scene analysis, transcript and the full export controls ── */}
        <div className="px-6 pb-6 pt-3">
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-border text-sm font-semibold text-foreground-muted hover:text-foreground hover:border-subtle focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
          >
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Details
          </button>
          {detailsOpen && (
            /* The editor renders its own 9:16 player for hook/caption placement;
               the dialog already has one, so it's suppressed here. */
            <SavedClipEditor clip={clip} hidePreview />
          )}
        </div>
      </div>
    </div>
  );
}
