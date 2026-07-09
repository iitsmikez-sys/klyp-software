"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ClipWithWords, CaptionStyle } from "@/lib/clips";
import { CAPTION_STYLES } from "@/lib/clips";
import { buildCaptionCues, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import { useSparks } from "./SparksProvider";
import { watermarkCanvasPos, WATERMARK_FONT_SIZE } from "@/lib/watermark";

/* ── Types ── */
interface Props {
  clip: ClipWithWords;
  analyzedUrl: string;
  initialStyle: CaptionStyle;
  /** Selected hook — overlaid on the first 3s of the preview, like the export burn. */
  hook?: string | null;
  hookStyle?: HookStyle;
  onClose: () => void;
  /** Called when the user confirms — style is the final selection. */
  onExport: (style: CaptionStyle) => void;
  exporting: boolean;
}

type Cue = { text: string; start: number; end: number };

/* ── Caption helpers ── */

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  t: number,
  wordCues: Cue[],
  cues: Cue[],
  style: CaptionStyle,
  W: number,
  H: number
) {
  // Scale font sizes relative to preview height (source = 1920px)
  const scale = H / 1920;
  const marginBottom = Math.round(80 * scale);
  const cx = W / 2;
  const cy = H - marginBottom;

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  if (style === "KLYP") {
    const word = wordCues.find((c) => t >= c.start && t < c.end);
    if (!word) return;

    const fs = Math.round(82 * scale);
    ctx.font = `bold ${fs}px Arial`;
    ctx.lineWidth = Math.max(2, 4 * scale);
    ctx.strokeStyle = "black";
    ctx.fillStyle = "#00E5A0";
    ctx.strokeText(word.text.toUpperCase(), cx, cy);
    ctx.fillText(word.text.toUpperCase(), cx, cy);
    return;
  }

  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return;

  if (style === "BOLD") {
    const fs = Math.round(82 * scale);
    ctx.font = `bold ${fs}px Arial`;
    ctx.lineWidth = Math.max(2, 4 * scale);
    ctx.strokeStyle = "black";
    ctx.fillStyle = "white";
  } else {
    // CLEAN
    const fs = Math.round(58 * scale);
    ctx.font = `${fs}px Arial`;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.fillStyle = "white";
  }

  // Simple single-line — 4 short words always fits at this scale
  ctx.strokeText(cue.text, cx, cy);
  ctx.fillText(cue.text, cx, cy);
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  t: number,
  W: number,
  H: number
) {
  const scale = H / 1920;
  const fs = Math.round(WATERMARK_FONT_SIZE * scale);
  ctx.font = `bold ${fs}px Arial`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const measured = ctx.measureText("klyp.world");
  const textW = measured.width;
  const textH = fs;

  const { x, y } = watermarkCanvasPos(t, W, H, textW, textH);

  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "white";
  ctx.fillText("klyp.world", x, y);
  ctx.globalAlpha = 1;
}

/* ── Time format helper ── */
function fmt(s: number) {
  const t = Math.max(0, Math.floor(s));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ── Component ── */
export default function ClipPreview({
  clip,
  analyzedUrl,
  initialStyle,
  hook,
  hookStyle = "BOXED",
  onClose,
  onExport,
  exporting,
}: Props) {
  const { tier } = useSparks();
  const isPro = tier === "pro";
  const [style, setStyle] = useState<CaptionStyle>(initialStyle);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const styleRef = useRef<CaptionStyle>(style);
  useEffect(() => { styleRef.current = style; }, [style]);

  // Pre-compute display cues once — same timing engine as the ASS burn, so
  // the preview matches the export exactly (seconds, clip-relative).
  const toSec = (c: { text: string; startMs: number; endMs: number }): Cue => ({
    text: c.text,
    start: c.startMs / 1000,
    end: c.endMs / 1000,
  });
  const cues = useRef<Cue[]>(
    buildCaptionCues(clip.words, clip.start_seconds * 1000, clip.end_seconds * 1000).map(toSec)
  );
  // One-word cues for the KLYP style.
  const wordCues = useRef<Cue[]>(
    buildCaptionCues(clip.words, clip.start_seconds * 1000, clip.end_seconds * 1000, 1).map(toSec)
  );

  // Fetch the preview MP4 on mount
  useEffect(() => {
    let blobUrl: string | null = null;

    fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: analyzedUrl,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
      }),
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error ?? "Preview failed.")));
        return res.blob();
      })
      .then((blob) => {
        blobUrl = URL.createObjectURL(blob);
        setPreviewUrl(blobUrl);
        setLoadingPreview(false);
      })
      .catch((err: Error) => {
        setLoadError(err.message);
        setLoadingPreview(false);
      });

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas rAF loop — starts once preview URL is ready
  useEffect(() => {
    if (!previewUrl) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const draw = () => {
      // Sync canvas dimensions to actual displayed size
      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = video.currentTime;
      drawCaptions(ctx, t, wordCues.current, cues.current, styleRef.current, canvas.width, canvas.height);
      if (hook) drawHookPreview(ctx, t, hook, hookStyle, canvas.width, canvas.height);
      if (!isPro) drawWatermark(ctx, t, canvas.width, canvas.height);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [previewUrl, isPro, hook, hookStyle]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
  }, []);

  const styleDescriptions: Record<CaptionStyle, string> = {
    BOLD: "Large white text, black outline — classic TikTok",
    CLEAN: "Smaller text, subtle shadow — minimalist",
    KLYP: "One word at a time in green — Klyp branded",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden"
           style={{ width: "min(360px, 95vw)", maxHeight: "95dvh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="min-w-0 mr-3">
            <p className="text-[11px] text-foreground-muted uppercase tracking-wider font-medium">Preview</p>
            <p className="font-syne text-sm font-bold text-foreground truncate">{clip.title}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Video + canvas */}
        <div className="relative bg-black overflow-hidden flex-shrink-0" style={{ aspectRatio: "9/16" }}>
          {loadingPreview && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground-muted text-sm">
              <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <span className="text-xs text-center px-4">
                Generating preview…<br/>
                <span className="text-subtle">(downloads source video first time)</span>
              </span>
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <p className="text-red-400 text-xs text-center">{loadError}</p>
            </div>
          )}
          {previewUrl && (
            <>
              <video
                ref={videoRef}
                src={previewUrl}
                className="w-full h-full object-contain"
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onClick={togglePlay}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </>
          )}
        </div>

        {/* Controls */}
        {previewUrl && (
          <div className="px-4 py-2.5 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-accent text-background hover:bg-accent-dim transition-colors"
              >
                {isPlaying ? (
                  <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
                    <rect x="0" y="0" width="3.5" height="13"/><rect x="7" y="0" width="3.5" height="13"/>
                  </svg>
                ) : (
                  <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
                    <polygon points="0,0 11,6.5 0,13"/>
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.05}
                value={currentTime}
                onChange={handleScrub}
                className="flex-1 h-1 accent-[#00E5A0] cursor-pointer"
              />
              <span className="flex-shrink-0 text-[11px] font-mono text-foreground-muted tabular-nums">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Style selector + export — scrollable if needed */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {/* Style pills */}
          <div>
            <p className="text-[11px] font-medium text-foreground-muted uppercase tracking-wider mb-2">
              Caption Style
            </p>
            <div className="flex gap-2">
              {CAPTION_STYLES.map((s) => {
                const active = style === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`flex-1 py-1.5 rounded-md border text-[11px] font-bold font-syne tracking-wide transition-colors ${
                      active
                        ? "bg-accent-glow border-accent/50 text-accent"
                        : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                    }`}
                  >
                    {s === "KLYP" ? "⚡ KLYP" : s}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-subtle mt-1.5">{styleDescriptions[style]}</p>
          </div>

          {/* Free tier watermark notice */}
          {!isPro && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-surface-2 border border-border">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p className="text-[10px] text-foreground-muted leading-relaxed">
                Free tier adds a moving <span className="text-accent font-semibold">klyp</span> watermark to exports.{" "}
                <a href="/dashboard/upgrade" className="text-accent hover:underline">Upgrade to Pro</a> to remove it.
              </p>
            </div>
          )}

          {/* Export button */}
          <button
            onClick={() => onExport(style)}
            disabled={exporting || loadingPreview || !!loadError}
            title={!isPro ? "Upgrade to Pro to remove the Klyp watermark" : undefined}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold font-syne transition-colors disabled:opacity-50
              bg-accent text-background hover:bg-accent-dim shadow-accent-glow-sm disabled:shadow-none"
          >
            {exporting ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
                Burning captions…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export with Captions
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
