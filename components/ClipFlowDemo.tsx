"use client";

/**
 * The "one VOD becomes several shorts" explainer under the hero.
 *
 * With demo footage installed (see lib/demo-reel.ts) this is a real reel: the
 * landscape source on the left, three vertical cuts on the right, each showing
 * its poster frame immediately and playing on click. Posters come from the
 * `poster` attribute, so a still is on screen before a byte of video loads and
 * nothing has to autoplay.
 *
 * Without the footage it falls back to a diagram built from Klyp's own
 * vocabulary — the clip categories MIDAS assigns, the caption styles, the
 * export ratios. That is deliberately not dressed up as a working player:
 * a still image wearing a play button would be a lie about what's there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Equalizer from "./Equalizer";
import { DEMO_SOURCE, DEMO_CLIPS } from "@/lib/demo-reel";

/**
 * Read a video's duration into state. The loadedmetadata event can fire before
 * React attaches its handler — a cached file on a repeat visit is ready almost
 * immediately — so the current readyState is checked on mount too, otherwise
 * the badge silently never appears.
 */
function useVideoDuration(ref: React.RefObject<HTMLVideoElement>) {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setDuration(Number.isFinite(el.duration) ? el.duration : null);
    if (el.readyState >= 1) read();
    el.addEventListener("loadedmetadata", read);
    return () => el.removeEventListener("loadedmetadata", read);
  }, [ref]);
  return duration;
}

/** mm:ss from a video's own metadata — never a hardcoded guess. */
function fmtDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* ── The mint analysis node between source and clips ── */
function FlowNode() {
  return (
    <div className="flex lg:flex-col items-center justify-center gap-3 py-2">
      <span className="hidden lg:block w-px h-8 bg-gradient-to-b from-transparent to-accent/40" />
      <div className="flex flex-col items-center gap-2">
        <p className="hidden lg:block text-[13px] text-center text-foreground-muted leading-tight max-w-[7rem]">
          Klyp finds the best moments
        </p>
        <span className="w-14 h-14 rounded-2xl bg-accent-glow border border-accent/30 flex items-center justify-center shadow-accent-glow-sm">
          <Equalizer className="flex w-9 h-6" barCount={5} />
        </span>
      </div>
      <span className="hidden lg:block w-px h-8 bg-gradient-to-t from-transparent to-accent/40" />
    </div>
  );
}

/* ── One vertical clip, poster first, plays on click ── */
function ClipCard({
  clip,
  onStartedPlaying,
}: {
  clip: (typeof DEMO_CLIPS)[number];
  onStartedPlaying: (el: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const duration = useVideoDuration(ref);
  // Driven by the element's own play/pause events, so being paused by a
  // sibling starting up restores this card's play button automatically.
  const [isPlaying, setIsPlaying] = useState(false);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Exclusivity is handled by the play event, so this just toggles.
    if (el.paused) void el.play().catch(() => { /* blocked — poster stays */ });
    else el.pause();
  }, []);

  const label = fmtDuration(duration);

  return (
    <div className="min-w-0 group/clip">
      {/* 9:16 — the vertical format Klyp exports by default. */}
      <div className="relative bg-black rounded-xl border border-border overflow-hidden" style={{ aspectRatio: "9 / 16" }}>
        <video
          ref={ref}
          data-demo
          src={clip.src}
          poster={clip.poster}
          aria-label={clip.label}
          preload="metadata"
          playsInline
          muted
          onPlay={(e) => { setIsPlaying(true); onStartedPlaying(e.currentTarget); }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onClick={toggle}
          className="absolute inset-0 w-full h-full object-cover cursor-pointer"
        />

        {/* Play affordance — hidden while playing so it never covers the clip. */}
        {!isPlaying && (
          <button
            type="button"
            onClick={toggle}
            aria-label={`Play ${clip.label}`}
            className="absolute inset-0 flex items-center justify-center focus:outline-none"
          >
            <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-sm border border-white/25 flex items-center justify-center transition-all group-hover/clip:bg-accent group-hover/clip:border-accent group-hover/clip:scale-110">
              <svg width="13" height="15" viewBox="0 0 16 18" fill="currentColor" className="ml-0.5 text-white group-hover/clip:text-background">
                <polygon points="0,0 16,9 0,18" />
              </svg>
            </span>
          </button>
        )}

        {label && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-mono tabular-nums pointer-events-none">
            {label}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 pt-12 pb-4 px-2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none text-center">
          <span className="font-geist text-white text-[11px] sm:text-xs font-black tracking-tight leading-tight drop-shadow-md">
            {clip.caption}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-foreground truncate">{clip.title}</p>
    </div>
  );
}

/* ── The reel, once footage is installed ── */
function DemoReel() {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const sourceDuration = useVideoDuration(sourceRef);

  /**
   * Only one thing plays at a time — three clips and a VOD at once is noise.
   * Hung off each element's own play event rather than the click handler, so
   * it holds however playback started (click, native controls, keyboard).
   */
  const pauseOthers = useCallback((el: HTMLVideoElement) => {
    document.querySelectorAll<HTMLVideoElement>("video[data-demo]").forEach((other) => {
      if (other !== el) other.pause();
    });
  }, []);

  const sourceLabel = fmtDuration(sourceDuration);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_auto_1fr] gap-6 lg:gap-5 items-center">
      {/* ── Source VOD ── */}
      <div className="rounded-2xl bg-surface/95 border border-border overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
            <p className="text-[13px] font-semibold text-foreground-muted truncate">
              Sample gaming footage
            </p>
          </div>
          {sourceLabel && (
            <span className="text-[12px] font-mono text-foreground-muted tabular-nums flex-shrink-0">
              {sourceLabel}
            </span>
          )}
        </div>
        {/* 16:9 — the shape a stream VOD actually arrives in. */}
        <div className="relative bg-black" style={{ aspectRatio: "16 / 9" }}>
          <video
            ref={sourceRef}
            data-demo
            src={DEMO_SOURCE.src}
            poster={DEMO_SOURCE.poster}
            aria-label={DEMO_SOURCE.label}
            controls
            preload="metadata"
            playsInline
            muted
            onPlay={(e) => pauseOthers(e.currentTarget)}
            className="absolute inset-0 w-full h-full object-contain"
          />
        </div>
      </div>

      <FlowNode />

      {/* ── Resulting shorts ── */}
      <div>
        <p className="text-[13px] font-semibold text-foreground-muted mb-3">
          Turned into vertical clips
        </p>
        <div className="grid grid-cols-3 gap-3">
          {DEMO_CLIPS.map((clip) => (
            <ClipCard key={clip.src} clip={clip} onStartedPlaying={pauseOthers} />
          ))}
        </div>
      </div>
      <p className="lg:col-span-3 text-center text-[11px] text-foreground-muted">
        Illustrative sample footage, manually edited to show the format. Not a customer result.
      </p>
    </div>
  );
}

/* ── Fallback: no footage installed ── */
function DemoDiagram() {
  /** Real clip categories (lib/clips.ts CLIP_TYPES) with their badge colors. */
  const outputs = [
    { type: "FUNNY", style: "bg-sky-500/15 text-sky-400 border-sky-500/30", caption: "BOLD" },
    { type: "CLUTCH", style: "bg-amber-500/15 text-amber-400 border-amber-500/30", caption: "KLYP" },
    { type: "RAGE", style: "bg-red-500/15 text-red-400 border-red-500/30", caption: "CLEAN" },
  ];

  return (
    <div aria-hidden className="grid grid-cols-1 lg:grid-cols-[1.15fr_auto_1fr] gap-6 lg:gap-5 items-center">
      <div className="rounded-2xl bg-surface/95 border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <p className="text-[13px] font-semibold text-foreground-muted">From your stream (VOD)</p>
        </div>
        <div className="relative aspect-video bg-gradient-to-br from-surface-2 via-surface to-background">
          <div className="absolute inset-0 flex items-center justify-center">
            <Equalizer className="flex w-40 opacity-60" />
          </div>
          <div className="absolute inset-x-4 bottom-4">
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div className="h-full w-2/3 bg-accent/70" />
            </div>
          </div>
        </div>
      </div>

      <FlowNode />

      <div>
        <p className="text-[13px] font-semibold text-foreground-muted mb-3">Turned into vertical clips</p>
        <div className="grid grid-cols-3 gap-3">
          {outputs.map((out) => (
            <div key={out.type} className="rounded-xl bg-surface/95 border border-border overflow-hidden">
              <div
                className="relative bg-gradient-to-b from-surface-2 to-background flex flex-col items-center justify-center gap-2"
                style={{ aspectRatio: "9 / 16" }}
              >
                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wide ${out.style}`}>
                  {out.type}
                </span>
                <span className="text-[10px] text-foreground-muted">{out.caption} captions</span>
                <span className="text-[10px] font-mono text-subtle">9:16</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ClipFlowDemo({ hasFootage }: { hasFootage: boolean }) {
  return hasFootage ? <DemoReel /> : <DemoDiagram />;
}
