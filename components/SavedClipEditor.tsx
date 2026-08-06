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
import type { SavedClip } from "@/lib/clip-ui";
import { processingFetch } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";

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

export default function SavedClipEditor({ clip }: { clip: SavedClip }) {
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

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
        drawHookPreview(ctx, video.currentTime, selectedHook, hookStyle, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [previewUrl, selectedHook, hookStyle]);

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
          url: clip.url,
          start_seconds: clip.start_seconds,
          end_seconds: clip.end_seconds,
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
    <div className="mt-4 pt-4 border-t border-border" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

      {/* ── Scene analysis (left): description + transcript with timestamps ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
            Scene Analysis
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
              <div key={i} className="flex items-start gap-3 px-3.5 py-2">
                <span className="flex-shrink-0 text-[10px] font-mono text-accent mt-0.5">
                  {fmtClipTime(cue.t)}
                </span>
                <p className="text-xs text-foreground-muted leading-relaxed">{cue.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No transcript saved for this clip — it was analyzed before word timestamps were stored.
          </p>
        )}
      </div>

      {/* ── Editing controls (right) ── */}
      <div className="space-y-4">
      {/* Preview player */}
      <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: "9/16", maxHeight: 380 }}>
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
            <video ref={videoRef} src={previewUrl} className="w-full h-full object-contain" controls playsInline />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </>
        )}
      </div>
      <p className="text-[10px] text-subtle text-center -mt-2">
        Hook shown live — captions are burned in on export.
      </p>

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
            {hasWords ? "Export with Captions" : "Export Clip"}
          </>
        )}
      </button>
      </div>
      </div>

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}
    </div>
  );
}
