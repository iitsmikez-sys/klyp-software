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
import SavedClipEditor from "./SavedClipEditor";
import ClipTrimControl from "./ClipTrimControl";
import { useSparks } from "./SparksProvider";
import { defaultClipEditDraft, readClipEditDraft, type ClipEditDraftV1 } from "@/lib/clip-edit-draft";
import { clipPreviewPlayback, clipPreviewActionBlocked } from "@/lib/clip-preview-state";
import { buildCaptionCues } from "@/lib/captions";
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
  initialDetailsOpen = false,
  onClipSaved,
}: Props) {
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
  const [playerTime, setPlayerTime] = useState(0);
  const { tier } = useSparks();
  const canTrim = tier === "pro";
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const trimStart = draft.start_seconds - clip.start_seconds;
  const trimEnd = draft.end_seconds - clip.start_seconds;
  const captionCues = useMemo(() => draft.words?.length
    ? buildCaptionCues(draft.words, draft.start_seconds * 1000, draft.end_seconds * 1000,
      draft.caption_style === "KLYP" ? 1 : 4)
    : [], [draft.words, draft.start_seconds, draft.end_seconds, draft.caption_style]);
  const editedTimeMs = (playerTime - trimStart) * 1000;
  const activeCaption = captionCues.find((cue) => editedTimeMs >= cue.startMs && editedTimeMs < cue.endMs);

  /** Drives the enter/exit transition: mounted → open → closing → unmounted. */
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
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
  const actionBlocked = clipPreviewActionBlocked(dirty);

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
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 font-geist ${
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
        className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto scrollbar-thin rounded-2xl bg-surface border border-border shadow-[0_32px_80px_-16px_rgba(0,0,0,0.9)]"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            {/* Wraps rather than truncates — on a phone the tail of a title is
                often the point of it ("…Then THIS Happened"). */}
            <h2 className="font-geist text-xl sm:text-2xl font-bold text-white leading-tight line-clamp-2">
              {draft.title}
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
                {fmtTime(draft.start_seconds)} → {fmtTime(draft.end_seconds)}
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
        <div className="mx-6 rounded-xl bg-black border border-border overflow-hidden">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
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
            {videoReady && draft.hook && editedTimeMs >= 0 && editedTimeMs < 3000 && (
              <div aria-hidden className="pointer-events-none absolute inset-x-8 top-5 text-center text-white text-xl sm:text-2xl font-black uppercase drop-shadow-[0_2px_3px_black]">
                {draft.hook}
              </div>
            )}
            {videoReady && activeCaption && (
              <div aria-hidden className={`pointer-events-none absolute inset-x-6 bottom-8 text-center font-black uppercase drop-shadow-[0_2px_3px_black] text-lg sm:text-2xl ${draft.caption_style === "KLYP" ? "text-accent" : "text-white"}`}>
                {activeCaption.text}
              </div>
            )}
          </div>
        </div>

        {/* Always-visible trim range. The preview contains the original saved
            cut; playback is bounded to these handles by clipPreviewPlayback. */}
        <div className="px-6 pt-4">
          <ClipTrimControl
            originalStart={clip.start_seconds} originalEnd={clip.end_seconds}
            start={draft.start_seconds} end={draft.end_seconds}
            playhead={playerTime} disabled={!canTrim}
            onChange={(start_seconds, end_seconds) => setDraft((current) => ({ ...current, start_seconds, end_seconds }))}
          />
          {!canTrim && <p className="mt-1 text-[10px] text-subtle">Trim editing is available with Pro.</p>}
        </div>

        {/* ── Actions ── */}
        <div className="px-6 pt-5 pb-2 flex flex-col sm:flex-row gap-3">
          {ready ? (
            <button
              onClick={onDownloadClip}
              disabled={actionBlocked}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-background text-base font-bold hover:bg-accent-dim shadow-accent-glow-sm focus:outline-none focus:ring-2 focus:ring-accent/60 transition-colors disabled:opacity-60"
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
              disabled={exporting || actionBlocked}
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
              href={vodLinkAt(clip.url, draft.start_seconds)}
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
        {dirty && <p className="mx-6 text-xs text-amber-300">Save your edits in Details to enable the main clip button, or export the current draft there.</p>}

        {exportState?.status === "error" && (
          <p className="mx-6 mt-1 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {exportState.error}{" "}
            <button onClick={onCreateClip} disabled={actionBlocked || exporting} className="underline font-semibold hover:text-red-300 disabled:opacity-50">
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
            <>
              {unsupportedDraft && <p role="alert" className="mt-3 text-xs text-amber-300">This clip has a newer or invalid saved draft. Original edit values are shown; use Reset to remove the stored draft.</p>}
              <SavedClipEditor clip={clip} draft={draft} onDraftChange={setDraft}
                onPersisted={(value) => {
                  const persisted = value ?? defaultClipEditDraft(clip);
                  setSavedDraft(persisted);
                  setUnsupportedDraft(false);
                  onClipSaved(value);
                }} dirty={dirty} hidePreview />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

