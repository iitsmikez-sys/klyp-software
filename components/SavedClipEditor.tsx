"use client";

/**
 * Inline editing panel for a saved clip (My Clips page). Mirrors the dashboard
 * analyze-flow export options: preview player, hook picker + hook text style,
 * caption style, format, and export. Hook options / caption words come from the
 * clips row (hooks/words columns, migration 003) — clips saved before that
 * migration can still be previewed and exported, just without those extras.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_LABELS, type CaptionStyle, type ExportFormat } from "@/lib/clips";
import { HOOK_STYLES, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import { useSparks } from "./SparksProvider";
import ProGateModal from "./ProGateModal";
import ClipTrimControl from "./ClipTrimControl";
import type { SavedClip } from "@/lib/clip-ui";
import { processingFetch } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";
import {
  deleteSegment, parseSegments, retimeWords, segmentIndexAtSource, sourceTimeAt, splitSegment,
  timelineDuration, timelineTimeAt, trimSegment, type EditSegment,
} from "@/lib/edit-segments";

/** Give a first-time source-VOD download plenty of room, but fail loudly eventually. */
const PREVIEW_TIMEOUT_MS = 6 * 60_000;
/** Export can include a first-time source download + full-quality burn — generous but finite. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;

const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  CLASSIC: "Classic — bold white, thick black outline",
  IMPACT: "Impact — heavy meme callout (default)",
  YELLOW: "Yellow — subtitle yellow",
  BOXED: "Boxed — white on black bar",
  NEON: "Neon — Klyp green",
};

function fmtClipTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SavedClipEditor({
  clip,
  workspace = false,
}: { clip: SavedClip; workspace?: boolean }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [transcriptOnly, setTranscriptOnly] = useState(false);
  const [proGateOpen, setProGateOpen] = useState(false);
  const { tier } = useSparks();
  const isPro = tier === "pro";

  const hooks = Array.isArray(clip.hooks) ? clip.hooks : [];
  const hasWords = Array.isArray(clip.words) && clip.words.length > 0;

  // Transcript cues for the scene analysis panel — clip-relative timestamps.
  const transcriptCues = useMemo(() => {
    if (!Array.isArray(clip.words) || clip.words.length === 0) return [];
    const cues: { t: number; text: string }[] = [];
    for (let i = 0; i < clip.words.length; i += 8) {
      const group = clip.words.slice(i, i + 8);
      cues.push({
        t: Math.max(0, group[0].start / 1000 - clip.start_seconds),
        text: group.map((w) => w.text).join(" "),
      });
    }
    return cues;
  }, [clip]);

  const [selectedHook, setSelectedHook] = useState<string | null>(hooks[0] ?? null);
  const [hookStyle, setHookStyle] = useState<HookStyle>("IMPACT");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("BOLD");
  const [format, setFormat] = useState<ExportFormat>("9:16");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewDuration, setPreviewDuration] = useState(
    Math.max(0, clip.end_seconds - clip.start_seconds)
  );
  const sourceDuration = Math.max(0, clip.end_seconds - clip.start_seconds);
  const [segments, setSegments] = useState<EditSegment[]>([
    { start: 0, end: sourceDuration },
  ]);
  const [selectedSegment, setSelectedSegment] = useState(0);
  const [undoStack, setUndoStack] = useState<Array<{
    segments: EditSegment[]; selected: number; time: number;
  }>>([]);
  const lastTrimRef = useRef<{ section: number; at: number } | null>(null);
  const editedDuration = timelineDuration(segments);
  const editedTime = timelineTimeAt(segments, currentTime);
  const editedCaptionCues = useMemo(() => {
    if (!Array.isArray(clip.words)) return [];
    const words = retimeWords(clip.words, clip.start_seconds, segments);
    const cues: { t: number; text: string }[] = [];
    for (let i = 0; i < words.length; i += 8) {
      const group = words.slice(i, i + 8);
      cues.push({ t: group[0].start / 1000, text: group.map((word) => word.text).join(" ") });
    }
    return cues;
  }, [clip, segments]);

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(seconds, video.duration || previewDuration));
    const kept = segmentIndexAtSource(segments, target);
    video.currentTime = kept >= 0
      ? target
      : segments.find((segment) => segment.start > target)?.start ?? segments[segments.length - 1].end;
    setCurrentTime(video.currentTime);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
    } else {
      if (video.currentTime >= segments[segments.length - 1].end - 0.05) {
        video.currentTime = segments[0].start;
      }
      video.play().catch(() => setPlaying(false));
    }
  };

  const onPreviewTimeUpdate = (video: HTMLVideoElement) => {
    const time = video.currentTime;
    const index = segmentIndexAtSource(segments, time);
    if (index < 0 || time >= segments[index].end - 0.04) {
      const next = index < 0
        ? segments.findIndex((segment) => segment.start > time)
        : index + 1;
      if (next >= 0 && next < segments.length) {
        video.currentTime = segments[next].start;
        setCurrentTime(segments[next].start);
        setSelectedSegment(next);
      } else {
        video.pause();
        video.currentTime = segments[segments.length - 1].end;
        setCurrentTime(segments[segments.length - 1].end);
      }
      return;
    }
    setCurrentTime(time);
    setSelectedSegment(index);
  };

  const applySegments = (next: EditSegment[], selected: number, trim = false) => {
    if (next === segments) return;
    const now = Date.now();
    const sameTrim = trim && lastTrimRef.current?.section === selected &&
      now - lastTrimRef.current.at < 800;
    if (!sameTrim) {
      setUndoStack((history) => [...history.slice(-29), { segments, selected: selectedSegment, time: currentTime }]);
    }
    lastTrimRef.current = trim ? { section: selected, at: now } : null;
    setSegments(next);
    setSelectedSegment(selected);
    const video = videoRef.current;
    const target = next[selected]?.start ?? next[0].start;
    if (video) video.currentTime = target;
    setCurrentTime(target);
  };

  const splitAtPlayhead = () => {
    const index = segmentIndexAtSource(segments, currentTime);
    if (index < 0) return;
    applySegments(splitSegment(segments, index, currentTime), index + 1);
  };

  const removeSelected = () => {
    const next = deleteSegment(segments, selectedSegment);
    applySegments(next, Math.min(selectedSegment, next.length - 1));
  };

  const trimSelected = (start: number, end: number) => {
    const selected = segments[selectedSegment];
    if (!selected) return;
    const handle = start !== selected.start ? "start" : "end";
    const proposed = handle === "start" ? start : end;
    applySegments(trimSegment(segments, selectedSegment, handle, proposed, sourceDuration), selectedSegment, true);
  };

  const undoEdit = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    lastTrimRef.current = null;
    setUndoStack((history) => history.slice(0, -1));
    setSegments(previous.segments);
    setSelectedSegment(previous.selected);
    if (videoRef.current) videoRef.current.currentTime = previous.time;
    setCurrentTime(previous.time);
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Keep the user's hook and export choices when they close and reopen the editor.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`klyp-editor-${clip.id}`);
      if (raw) {
        const saved = JSON.parse(raw) as {
          hook?: string | null; hookStyle?: HookStyle;
          captionStyle?: CaptionStyle; format?: ExportFormat;
          segments?: unknown;
        };
        if (typeof saved.hook === "string" || saved.hook === null) setSelectedHook(saved.hook);
        if (saved.hookStyle && HOOK_STYLES.includes(saved.hookStyle)) setHookStyle(saved.hookStyle);
        if (saved.captionStyle && CAPTION_STYLES.includes(saved.captionStyle)) setCaptionStyle(saved.captionStyle);
        if (saved.format && EXPORT_FORMATS.includes(saved.format)) setFormat(saved.format);
        if (saved.segments) setSegments(parseSegments(saved.segments, sourceDuration));
      }
    } catch { /* A malformed old draft should not prevent editing. */ }
    setDraftReady(true);
  }, [clip.id]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      localStorage.setItem(`klyp-editor-${clip.id}`, JSON.stringify({
        hook: selectedHook, hookStyle, captionStyle, format, segments,
      }));
    } catch { /* Storage can be unavailable; editing and export still work. */ }
  }, [clip.id, draftReady, selectedHook, hookStyle, captionStyle, format, segments]);

  // Live hook overlay on the preview — mirrors the export burn and reacts
  // instantly to hook/style changes (the loop redraws every frame, playing or not).
  useEffect(() => {
    if (!previewUrl) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const draw = () => {
      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (selectedHook) {
        drawHookPreview(ctx, timelineTimeAt(segments, video.currentTime), selectedHook, hookStyle, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [previewUrl, selectedHook, hookStyle, segments]);

  // The native timeupdate event fires only a few times per second. Check cut
  // boundaries each animation frame so playback does not reveal a deleted beat.
  useEffect(() => {
    if (!previewUrl) return;
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const followCuts = () => {
      if (!video.paused) {
        const index = segmentIndexAtSource(segments, video.currentTime);
        if (index < 0 || video.currentTime >= segments[index].end - 0.03) {
          onPreviewTimeUpdate(video);
        }
      }
      frame = requestAnimationFrame(followCuts);
    };
    frame = requestAnimationFrame(followCuts);
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, segments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the cut preview on expand (source video is cached server-side per URL).
  // First view of a VOD legitimately takes minutes (full source download), so
  // the timeout is generous — but finite, so a wedged request fails loudly
  // instead of spinning forever. Aborting the fetch doesn't cancel the server
  // download, so a Retry after a timeout usually joins the finished cache.
  useEffect(() => {
    let blobUrl: string | null = null;
    let timedOut = false;
    setLoadingPreview(true);
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
        clip_id: clip.id,
        url: clip.url,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
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
        setLoadingPreview(false);
      })
      .catch((err: Error) => {
        settle();
        if (controller.signal.aborted && !timedOut) return; // unmounted — leave state alone
        setLoadError(
          timedOut
            ? `Preview timed out after ${Math.round(PREVIEW_TIMEOUT_MS / 60_000)} minutes. The source VOD may still be downloading in the background — hit Retry in a bit.`
            : err.message
        );
        setLoadingPreview(false);
      });
    return () => {
      settle();
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [clip.id, retryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportClip = async () => {
    setExporting(true);
    setExportError(null);
    // Timeout so a hung export fails loudly instead of spinning forever. The
    // server keeps working after an abort, so a retry usually hits a warm cache.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    try {
      const res = await processingFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clip_id: clip.id,
          url: clip.url,
          start_seconds: clip.start_seconds,
          end_seconds: clip.end_seconds,
          segments,
          title: clip.title,
          style: hasWords ? captionStyle : undefined,
          words: hasWords ? clip.words : undefined,
          hook: selectedHook ?? undefined,
          hook_style: hookStyle,
          handle: getStoredHandle(),
          aspect_ratio: format,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Export failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const safe = clip.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = (safe || "klyp_clip") + ".mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setExportError(
        controller.signal.aborted
          ? "Export timed out after 10 minutes — the source VOD may still be downloading in the background. Try again in a bit."
          : err instanceof Error ? err.message : "Export failed."
      );
    } finally {
      clearTimeout(timeout);
      setExporting(false);
    }
  };

  return (
    <div className={workspace ? "pt-4" : "mt-4 pt-4 border-t border-border"} onClick={(e) => e.stopPropagation()}>
      <div className={workspace
        ? "grid grid-cols-1 lg:grid-cols-[minmax(230px,1fr)_minmax(360px,2fr)_minmax(260px,1fr)] gap-4 items-start"
        : "grid grid-cols-1 lg:grid-cols-2 gap-6 items-start"}>

      {/* ── Scene analysis (left): description + transcript with timestamps ── */}
      <div className={workspace
        ? "order-2 lg:order-1 min-w-0 rounded-xl border border-border bg-background p-4 space-y-3"
        : "space-y-3"}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
            Transcript / Scene Analysis
          </p>
          <button
            type="button"
            onClick={() => setTranscriptOnly((v) => !v)}
            className={`px-2.5 py-1 rounded-md border text-[10px] font-bold font-syne tracking-wide transition-colors ${
              transcriptOnly
                ? "bg-accent-glow border-accent/50 text-accent"
                : "border-border text-foreground-muted hover:border-subtle"
            }`}
          >
            Transcript only
          </button>
        </div>

        {!transcriptOnly && (
          <div className="px-3.5 py-3 rounded-lg bg-surface-2 border border-border space-y-1.5">
            <p className="text-[10px] font-bold font-syne tracking-wide text-accent">{clip.clip_type}</p>
            {clip.reason && <p className="text-xs text-foreground-muted leading-relaxed">{clip.reason}</p>}
            {clip.caption && <p className="text-xs text-subtle leading-relaxed italic">{clip.caption}</p>}
          </div>
        )}

        {transcriptCues.length > 0 ? (
          <div className="max-h-96 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-surface-2/50 divide-y divide-border">
            {transcriptCues.map((cue, i) => (
              <button
                key={i}
                type="button"
                onClick={() => seekTo(cue.t)}
                disabled={segmentIndexAtSource(segments, cue.t) < 0}
                className="w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-surface-2 focus:outline-none focus:bg-surface-2 disabled:opacity-35 disabled:line-through disabled:cursor-not-allowed"
              >
                <span className="flex-shrink-0 text-[10px] font-mono text-accent mt-0.5">
                  {fmtClipTime(cue.t)}
                </span>
                <p className="text-xs text-foreground-muted leading-relaxed">{cue.text}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No transcript saved for this clip — it was analyzed before word timestamps were stored.
          </p>
        )}
      </div>

      {/* ── Vertical preview (centre) ── */}
      <div className="order-1 lg:order-2 min-w-0 rounded-xl border border-border bg-background p-3">
        <p className="mb-3 text-sm font-semibold text-foreground">Preview</p>
        <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: "9/16", maxHeight: workspace ? "min(58dvh, 660px)" : 380 }}>
        {loadingPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground-muted">
            <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-xs text-center px-4">
              Generating preview…{elapsed >= 5 ? ` (${fmtClipTime(elapsed)})` : ""}<br />
              <span className="text-subtle">
                {elapsed < 30
                  ? "(downloads source video first time)"
                  : "Still downloading the source VOD — long VODs can take several minutes."}
              </span>
            </span>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
            <p className="text-red-400 text-xs text-center">{loadError}</p>
            <button
              onClick={() => setRetryToken((t) => t + 1)}
              className="px-3 py-1.5 rounded-md border border-border text-xs font-bold font-syne text-foreground-muted hover:text-foreground hover:border-accent/50 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {previewUrl && (
          <>
            <video
              ref={videoRef}
              src={previewUrl}
              className="w-full h-full object-contain cursor-pointer"
              playsInline
              onClick={togglePlayback}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              muted={muted}
              onTimeUpdate={(e) => onPreviewTimeUpdate(e.currentTarget)}
              onLoadedMetadata={(e) => {
                setPreviewDuration(e.currentTarget.duration || previewDuration);
                e.currentTarget.currentTime = segments[0].start;
              }}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </>
        )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-foreground-muted">
          <button type="button" onClick={togglePlayback} disabled={!previewUrl} className="rounded-md border border-border px-3 py-1 text-foreground hover:border-accent/50 disabled:opacity-40">
            {playing ? "Pause" : "Play"}
          </button>
          <span className="font-mono">{fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}</span>
          <button type="button" onClick={() => setMuted((value) => !value)} disabled={!previewUrl} className="rounded-md border border-border px-2 py-1 text-foreground hover:border-accent/50 disabled:opacity-40" aria-label={muted ? "Unmute preview" : "Mute preview"}>
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      <p className="text-[10px] text-subtle text-center mt-1">
        Hook shown live — captions are burned in on export.
      </p>
      </div>

      {/* ── Editing controls (right) ── */}
      <div className="order-3 min-w-0 space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Clip settings</h3>
        <span className="text-[10px] text-subtle">Saved on this device</span>
      </div>
      {workspace && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-foreground-muted">
          <p className="font-semibold text-foreground">Section {selectedSegment + 1} of {segments.length}</p>
          <p className="mt-1 font-mono">
            {fmtClipTime(segments[selectedSegment]?.start ?? 0)}–{fmtClipTime(segments[selectedSegment]?.end ?? 0)} in the original moment
          </p>
        </div>
      )}

      {/* Hook options */}
      <div>
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
          Hook{" "}
          <span className="font-normal normal-case tracking-normal text-subtle">
            — shown on screen for the first 3s
          </span>
        </p>
        {hooks.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {hooks.map((hookText) => {
              const selected = selectedHook === hookText;
              return (
                <button
                  key={hookText}
                  onClick={() => setSelectedHook(selected ? null : hookText)}
                  disabled={exporting}
                  className={`text-left px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                    selected
                      ? "bg-accent-glow border-accent/50 text-accent font-semibold"
                      : "bg-surface-2 border-border text-foreground-muted hover:border-subtle"
                  }`}
                >
                  {selected ? "✓ " : ""}{hookText}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No hook options saved for this clip — it was analyzed before hooks were stored. Type your own below.
          </p>
        )}
        {/* Editable hook text — picking an option above fills this in; tweak freely. */}
        <input
          type="text"
          value={selectedHook ?? ""}
          onChange={(e) => setSelectedHook(e.target.value.length > 0 ? e.target.value.slice(0, 80) : null)}
          placeholder="Type a custom hook, or pick one above"
          maxLength={80}
          disabled={exporting}
          className="mt-1.5 w-full px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs text-foreground placeholder:text-subtle focus:outline-none focus:border-accent/50 disabled:opacity-50"
        />
        <p className="text-[10px] text-subtle mt-1">
          Burned on screen in ALL CAPS for the first 3s — clear the field to export without a hook.
        </p>
      </div>

      {/* Hook text style */}
      {selectedHook && (
        <div>
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
            Hook Text Style
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setHookStyle(s)}
                disabled={exporting}
                title={HOOK_STYLE_LABELS[s]}
                className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  hookStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-subtle mt-1.5">{HOOK_STYLE_LABELS[hookStyle]}</p>
        </div>
      )}

      {/* Caption style */}
      <div>
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
          Caption Style
        </p>
        {hasWords ? (
          <div className="flex gap-2">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setCaptionStyle(s)}
                disabled={exporting}
                className={`flex-1 py-1.5 rounded-md border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  captionStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {s === "KLYP" ? "⚡ KLYP" : s}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No word timestamps saved for this clip — captions aren&apos;t available. New analyses save them automatically.
          </p>
        )}
      </div>

      {/* Format */}
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
          Format
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {EXPORT_FORMATS.map((f) => {
            const locked = !isPro && f !== "9:16";
            return (
              <button
                key={f}
                onClick={() => (locked ? setProGateOpen(true) : setFormat(f))}
                disabled={exporting}
                title={locked ? "Format switching is a Pro feature" : FORMAT_LABELS[f]}
                className={`px-2.5 py-1.5 text-[11px] font-bold font-syne transition-colors disabled:opacity-50 ${
                  format === f
                    ? "bg-accent-glow text-accent"
                    : "bg-surface-2 text-foreground-muted hover:text-foreground"
                } ${locked ? "opacity-60" : ""}`}
              >
                {f}
                {locked && " 🔒"}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] text-subtle">{FORMAT_LABELS[format]}</span>
      </div>

      {exportError && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {exportError}
        </div>
      )}

      {/* Preview is just a look-before-you-export convenience — export makes its
          own independent request to /api/clip and doesn't need previewUrl, so a
          stuck or failed preview should never block it. */}
      {(loadingPreview || loadError) && (
        <p className="text-[10px] text-subtle">
          {loadError ? "Preview unavailable — you can still export below." : "Preview still loading — export doesn't need to wait for it."}
        </p>
      )}

      {/* Export */}
      <button
        onClick={exportClip}
        disabled={exporting}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none"
      >
        {exporting ? (
          <>
            <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
            Burning &amp; exporting…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export clip
          </>
        )}
      </button>
      </div>
      </div>

      {workspace && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-foreground">Timeline</h3>
            <span className="font-mono text-xs text-foreground-muted">
              {fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={splitAtPlayhead}
              disabled={!previewUrl || exporting || splitSegment(segments, segmentIndexAtSource(segments, currentTime), currentTime) === segments}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/50 disabled:opacity-40"
            >
              ✂ Split at playhead
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={segments.length <= 1 || exporting}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-red-400/50 disabled:opacity-40"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={undoEdit}
              disabled={undoStack.length === 0 || exporting}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/50 disabled:opacity-40"
            >
              Undo
            </button>
            <span className="text-[11px] text-foreground-muted">Select a section on the video track to remove it.</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(editedDuration, 0.1)}
            step={0.1}
            value={Math.min(editedTime, editedDuration)}
            onChange={(e) => seekTo(sourceTimeAt(segments, Number(e.target.value)))}
            aria-label="Seek clip timeline"
            className="w-full accent-accent"
            disabled={!previewUrl}
          />
          <div className="mt-2 flex items-center gap-3 rounded-md bg-surface-2 px-3 py-3">
            <span className="w-16 shrink-0 text-[11px] font-semibold text-foreground-muted">Video</span>
            <div className="flex min-w-0 flex-1 gap-1">
              {segments.map((segment, index) => (
                <button
                  key={`${segment.start}-${segment.end}`}
                  type="button"
                  onClick={() => { setSelectedSegment(index); seekTo(segment.start); }}
                  style={{ flex: `${segment.end - segment.start} 1 0%` }}
                  aria-label={`Select section ${index + 1}, ${fmtClipTime(segment.end - segment.start)}`}
                  aria-pressed={selectedSegment === index}
                  className={`h-10 min-w-8 truncate rounded px-2 text-left text-[11px] font-semibold transition-colors ${
                    selectedSegment === index
                      ? "bg-accent/25 border-2 border-accent text-foreground"
                      : "bg-accent/10 border border-accent/30 text-foreground-muted hover:border-accent/70"
                  }`}
                >
                  Section {index + 1} · {fmtClipTime(segment.end - segment.start)}
                </button>
              ))}
            </div>
          </div>
          {segments[selectedSegment] && (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Trim section {selectedSegment + 1}</p>
              <ClipTrimControl
                originalStart={selectedSegment === 0 ? 0 : segments[selectedSegment - 1].end}
                originalEnd={selectedSegment === segments.length - 1 ? sourceDuration : segments[selectedSegment + 1].start}
                start={segments[selectedSegment].start}
                end={segments[selectedSegment].end}
                playhead={currentTime}
                disabled={!isPro || exporting}
                onChange={trimSelected}
              />
              {!isPro && <p className="mt-2 text-[10px] text-subtle">Trim editing is available with Pro.</p>}
            </div>
          )}
          {editedCaptionCues.length > 0 && (
            <div className="mt-1 flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-foreground-muted">Captions</span>
              <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
                {editedCaptionCues.map((cue, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => seekTo(sourceTimeAt(segments, cue.t))}
                    style={{
                      left: `${(cue.t / editedDuration) * 100}%`,
                      width: `${Math.min(24, Math.max(5, 2 / editedDuration * 100))}%`,
                    }}
                    className="absolute top-0 h-8 truncate rounded bg-blue-500/20 border border-blue-400/30 px-2 text-left text-[10px] text-blue-100 hover:border-blue-300"
                    title={`${fmtClipTime(cue.t)} ${cue.text}`}
                  >
                    {cue.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}
    </div>
  );
}


