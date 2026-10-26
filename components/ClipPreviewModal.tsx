"use client";

/**
 * Centred preview dialog for a saved clip, opened from a card's thumbnail or
 * play button. Replaces the old inline expansion, which reflowed the grid
 * (the card grew to span both columns and pushed everything below it).
 *
 * Opening is deliberately quick rather than theatrical: the backdrop fades,
 * the panel lifts the last few pixels into place, and the clip's own frame is
 * on screen immediately — taken from the cache the card already filled, so no
 * second request — then crossfades to video once the first frame decodes.
 * Nothing is ever held back artificially; the frame simply covers the gap
 * while /api/preview cuts the segment.
 *
 * The player shows the clip at the source's own aspect ratio (crop:false),
 * since cropping a 16:9 moment to vertical here would hide most of the frame.
 * The MP4 is already cut to the clip's range, so the native control bar's
 * elapsed/total time is clip-relative and playback stops at the clip's end.
 *
 * Export state lives in the clips page, not here, so a render keeps running —
 * and stays visible on the card — when the dialog is closed mid-export.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { previewSourceStart } from '@/lib/editor-preview';
import SavedClipEditor from "./SavedClipEditor";
import { defaultClipEditDraft, readClipEditDraft, type ClipEditDraftV1 } from "@/lib/clip-edit-draft";
import { clipPreviewPlayback } from "@/lib/clip-preview-state";
import type { RawDownloadState } from "./useRawClipDownloads";
import { processingFetch } from "@/lib/processing-api";
import { peekClipThumbnail, loadClipThumbnail } from "@/lib/clip-thumbnails";
import { playOpenSound } from "@/lib/ui-sound";
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
/** Matches the CSS below; the panel is unmounted once the fade-out ends. */
const CLOSE_MS = 140;
/** Only badge the wait as "loading" if the video hasn't arrived promptly. */
const SPINNER_AFTER_MS = 400;

interface Props {
  clip: SavedClip;
  onClose: () => void;
  /** Export progress for this clip, owned by the page so it survives closing. */
  exportState: ExportState | undefined;
  onCreateClip: () => void;
  onDownloadClip: () => void;
  rawState?: RawDownloadState;
  onDownloadRaw?: () => void;
  /** Opened from an editing action in the card's ⋯ menu, which lives in Details. */
  initialDetailsOpen?: boolean;
  onClipSaved: (draft: ClipEditDraftV1 | null) => void;
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
  rawState,
  onDownloadRaw,
  initialDetailsOpen = false,
  onClipSaved,
}: Props) {
  const [sourceStart, setSourceStart] = useState(clip.start_seconds);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [poster, setPoster] = useState<string | null>(() => peekClipThumbnail(clip));
  const [showSpinner, setShowSpinner] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const initialEdit = useMemo(() => readClipEditDraft(clip), [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(initialEdit.draft);
  const [savedDraft, setSavedDraft] = useState(initialEdit.draft);
  const [unsupportedDraft, setUnsupportedDraft] = useState(initialEdit.unsupportedVersion);
  const [pendingLayout, setPendingLayout] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const trimStart = clip.start_seconds - sourceStart;
  const trimEnd = clip.end_seconds - sourceStart;

  /** Drives the enter/exit transition: mounted → open → closing → unmounted. */
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dirtyRef = useRef(dirty || pendingLayout);
  dirtyRef.current = dirty || pendingLayout;
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const next = clipPreviewPlayback(video.currentTime, trimStart, trimEnd);
      if (next.time !== video.currentTime) {
        if (next.pause) video.pause();
        video.currentTime = next.time;
        setPlayerTime(next.time);
      }
    }
  }, [trimStart, trimEnd]);

  /* ── Enter transition ── */
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // Next frame, so the browser paints the "from" state before transitioning.
    const raf = requestAnimationFrame(() => setEntered(true));
    playOpenSound();
    return () => cancelAnimationFrame(raf);
  }, []);

  /**
   * Begin closing: playback and audio stop on this tick, not when the fade
   * ends, so a close always silences the clip instantly.
   */
  const beginClose = useCallback(() => {
    if (closeTimer.current) return; // already closing — ignore repeat Escape/clicks
    if (dirtyRef.current && !window.confirm("You have unsaved clip edits. Close without saving?")) return;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, reducedMotion ? 0 : CLOSE_MS);
  }, [onClose, reducedMotion]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  /* ── Escape to close, and a focus trap so Tab can't reach the grid behind ── */
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        beginClose();
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

    // Lock the page behind. overflow:hidden alone scrolls the grid back to the
    // top, so pin the body at its current offset and put it back on close —
    // the grid ends up exactly where the user left it.
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollY);
      restoreTo?.focus?.();
    };
  }, [beginClose]);

  /* ── Stop playback and audio whenever this dialog goes away ── */
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

  /* ── The clip's own frame, shown while the video is cut ── */
  useEffect(() => {
    if (poster) return;
    let active = true;
    loadClipThumbnail(clip)
      .then((url) => { if (active) setPoster(url); })
      .catch(() => { /* placeholder gradient covers it */ });
    return () => { active = false; };
  }, [clip, poster]);

  /* ── Fetch the cut preview (source aspect ratio, not the 9:16 export crop) ── */
  useEffect(() => {
    let blobUrl: string | null = null;
    let timedOut = false;
    setVideoReady(false);
    setShowSpinner(false);
    setLoadError(null);
    setElapsed(0);
    const startedAt = Date.now();
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    // A fast preview shouldn't flash a spinner; a slow one should explain itself.
    const spinnerTimer = setTimeout(() => setShowSpinner(true), SPINNER_AFTER_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, PREVIEW_TIMEOUT_MS);
    const settle = () => { clearInterval(ticker); clearTimeout(timeout); clearTimeout(spinnerTimer); };

    processingFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Lets the server serve the archived 540p proxy, which works even
        // once the source VOD is gone.
        clip_id: clip.id,
        url: clip.url,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        crop: false,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d?.error ?? "Preview failed.")));
        setSourceStart(previewSourceStart(clip.start_seconds, res.headers.get('X-Klyp-Source')));
        return res.blob();
      })
      .then((blob) => {
        settle();
        blobUrl = URL.createObjectURL(blob);
        setPreviewUrl(blobUrl);
      })
      .catch((err: Error) => {
        settle();
        if (controller.signal.aborted && !timedOut) return; // closed or switched clips
        setLoadError(
          timedOut
            ? `Preview timed out after ${Math.round(PREVIEW_TIMEOUT_MS / 60_000)} minutes. The source VOD may still be downloading in the background — try again in a bit.`
            : err.message
        );
        setShowSpinner(false);
      });

    return () => {
      settle();
      // Switching clips or closing mid-flight: drop this request and its blob
      // so no stale footage can land in a later view.
      controller.abort();
      setPreviewUrl(null);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [clip.id, retryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBackdrop = useCallback(
    (e: React.MouseEvent) => { if (e.target === e.currentTarget) beginClose(); },
    [beginClose]
  );

  const platform = platformName(clip.url);
  const isUpload = clip.url.startsWith("upload:");
  const exporting = exportState?.status === "working";
  const ready = exportState?.status === "ready";
  const actionBlocked = dirty || pendingLayout;

  /* Only opacity and transform animate; the backdrop's blur is static so it
     never triggers a per-frame filter repaint. */
  const visible = entered && !closing;
  const panelStyle: React.CSSProperties = reducedMotion
    ? { opacity: visible ? 1 : 0, transition: `opacity ${visible ? 120 : 0}ms linear` }
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.97) translateY(8px)",
        transition: visible
          ? "opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)"
          : `opacity ${CLOSE_MS}ms ease-in, transform ${CLOSE_MS}ms ease-in`,
        willChange: "opacity, transform",
      };

  return (
    <div
      onMouseDown={onBackdrop}
      className={`fixed inset-0 z-50 flex items-center justify-center p-2 font-geist sm:p-4 ${
        reducedMotion ? "" : "backdrop-blur-sm"
      }`}
      style={{
        backgroundColor: "rgba(0,0,0,0.8)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${visible ? 180 : CLOSE_MS}ms ease-out`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${clip.title}`}
        style={panelStyle}
        className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl scrollbar-thin"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            {/* Wraps rather than truncates — on a phone the tail of a title is
                often the point of it ("…Then THIS Happened"). */}
            <h2 className="line-clamp-2 font-geist text-xl font-semibold leading-tight text-white sm:text-2xl">
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
                {fmtTime(clip.start_seconds)} → {fmtTime(clip.end_seconds)} · {fmtTime(clip.end_seconds - clip.start_seconds)} long
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={beginClose}
            aria-label="Close preview"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-foreground-muted hover:text-foreground hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Player ── object-contain keeps the source aspect ratio intact ── */}
        <div className="mx-4 overflow-hidden rounded-lg bg-black sm:mx-6">
          <div className="relative min-h-[210px] w-full" style={{ height: "min(48dvh, 440px)" }}>
            {/* The clip's own frame, under the video and crossfaded out once
                the first video frame has decoded. */}
            {poster && !loadError && (
              <img
                src={poster}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: videoReady ? 0 : 1,
                  transition: reducedMotion ? "none" : "opacity 220ms ease-out",
                }}
              />
            )}

            {showSpinner && !videoReady && !loadError && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-t from-black/85 to-transparent">
                <span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <span className="text-sm text-white/90">
                  Loading preview{elapsed >= 20 ? " — downloading the source VOD" : ""}
                  {elapsed >= 5 ? ` (${fmtElapsed(elapsed)})` : ""}
                </span>
              </div>
            )}

            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-black/70">
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
                onLoadedData={() => {
                  setVideoReady(true);
                  if (videoRef.current) videoRef.current.currentTime = trimStart;
                }}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  const next = clipPreviewPlayback(video.currentTime, trimStart, trimEnd);
                  if (next.pause) video.pause();
                  if (next.time !== video.currentTime) video.currentTime = next.time;
                  setPlayerTime(video.currentTime);
                }}
                onPlay={(event) => {
                  const next = clipPreviewPlayback(event.currentTarget.currentTime, trimStart, trimEnd);
                  if (next.time !== event.currentTarget.currentTime) event.currentTarget.currentTime = next.time;
                }}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: videoReady ? 1 : 0,
                  transition: reducedMotion ? "none" : "opacity 220ms ease-out",
                }}
              />
            )}
          </div>
        </div>

        {/* The source preview and raw download always use the detected moment. */}
        <div className="flex flex-wrap gap-2 px-4 pt-4 pb-2 sm:px-6">
          <Link href={"/dashboard/clips/" + clip.id + "/edit"} className="flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-background hover:bg-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Edit Clip</Link>
          <button type="button" onClick={onDownloadRaw} disabled={!onDownloadRaw || rawState?.status === "working"}
            className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
            {rawState?.status === "working" ? (rawState.received !== undefined ? "Downloading " + rawState.received + "%" : "Preparing raw " + rawState.seconds + "s")
              : rawState?.status === "ready" ? "Download Raw Again" : "Download Raw"}
          </button>
          {!isUpload && <a href={vodLinkAt(clip.url, clip.start_seconds)} target="_blank" rel="noopener noreferrer"
            className="self-center px-2 py-2 text-sm text-foreground-muted hover:text-accent">Watch Original ↗</a>}
        </div>
        {rawState?.status === "error" && <p role="alert" className="mx-6 mt-1 text-sm text-red-400">{rawState.error} <button type="button" onClick={onDownloadRaw} className="underline">Retry</button></p>}
        {dirty && <p className="mx-6 text-xs text-amber-300">You have unsaved quick export settings. Save them before leaving this preview.</p>}

        {exportState?.status === "error" && (
          <p className="mx-6 mt-1 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {exportState.error}{" "}
            <button onClick={onCreateClip} disabled={draft.version !== 1 || actionBlocked || exporting} className="underline font-semibold hover:text-red-300 disabled:opacity-50">
              Try again
            </button>
          </p>
        )}
        {exportState?.status === "ready" && exportState.warning && (
          <p role="status" className="mx-6 mt-1 px-4 py-2.5 rounded-lg border border-amber-500/30 text-sm text-amber-300">{exportState.warning}</p>
        )}

        {/* ── Details: scene analysis, transcript and the full export controls ── */}
        <div className="px-4 pb-4 pt-3 sm:px-6 sm:pb-5">
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
            <div className="pt-3 text-sm text-foreground-muted">
              {clip.reason && <p className="mb-2"><span className="font-medium text-foreground">Why this moment:</span> {clip.reason}</p>}
              {clip.caption && <p className="mb-2">{clip.caption}</p>}
              <p>Original VOD: {fmtTime(clip.start_seconds)} – {fmtTime(clip.end_seconds)}</p>
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-foreground-muted hover:text-foreground">Quick export settings</summary>
                {unsupportedDraft && <p role="alert" className="mt-3 text-xs text-amber-300">This clip has a newer or invalid saved draft. Original edit values are shown; use Reset to remove the stored draft.</p>}
                {draft.version !== 1 ? <p role="status" className="mt-3 text-sm text-amber-300">This clip has timeline edits. Open the full timeline editor to change or export this draft.</p> : <SavedClipEditor clip={clip} draft={draft} onDraftChange={setDraft}
                onPersisted={(value) => {
                  const persisted = value ?? defaultClipEditDraft(clip);
                  setSavedDraft(persisted);
                  setUnsupportedDraft(false);
                  onClipSaved(value);
                }} dirty={dirty} hidePreview sourcePreviewUrl={previewUrl} sourcePreviewStart={sourceStart} onLayoutPendingChange={setPendingLayout} />}
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
