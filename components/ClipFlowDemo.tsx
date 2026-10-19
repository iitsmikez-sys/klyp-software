"use client";

/**
 * The "one VOD becomes several shorts" explainer under the hero.
 *
 * Deliberately a diagram, not a reel of sample clips: Klyp ships no demo
 * footage, and real clips are per-account and behind auth, so anything that
 * looked like a finished clip here would be invented — as would view counts or
 * performance figures. Everything shown is real product vocabulary instead:
 * the clip categories MIDAS assigns, the three caption styles, and the export
 * formats actually offered.
 *
 * Purely decorative, so it's hidden from assistive tech; the surrounding copy
 * carries the meaning.
 */
import Equalizer from "./Equalizer";

/** Real clip categories (lib/clips.ts CLIP_TYPES) with their badge colors. */
const OUTPUTS = [
  { type: "FUNNY", style: "bg-sky-500/15 text-sky-400 border-sky-500/30", caption: "BOLD", ratio: "9:16" },
  { type: "CLUTCH", style: "bg-amber-500/15 text-amber-400 border-amber-500/30", caption: "KLYP", ratio: "9:16" },
  { type: "RAGE", style: "bg-red-500/15 text-red-400 border-red-500/30", caption: "CLEAN", ratio: "9:16" },
];

export default function ClipFlowDemo() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-1 lg:grid-cols-[1.15fr_auto_1fr] gap-6 lg:gap-5 items-center"
    >
      {/* ── Source VOD ── */}
      <div className="rounded-2xl bg-surface/95 backdrop-blur-sm border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <p className="text-[13px] font-semibold text-foreground-muted">From your stream (VOD)</p>
        </div>
        {/* 16:9 source frame — the shape a stream VOD actually arrives in. */}
        <div className="relative aspect-video bg-gradient-to-br from-surface-2 via-surface to-background">
          <div className="absolute inset-0 flex items-center justify-center">
            <Equalizer className="flex w-40 opacity-60" />
          </div>
          {/* Scrub bar: the long timeline the analysis reads end to end. */}
          <div className="absolute inset-x-4 bottom-4">
            <div className="h-1 rounded-full bg-border overflow-hidden">
              <div className="h-full w-2/3 bg-accent/70" />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-foreground-muted">
              <span>1:26:03</span>
              <span>2:14:17</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── The analysis step ── */}
      <div className="flex lg:flex-col items-center justify-center gap-3 py-2">
        <span className="hidden lg:block w-px h-8 bg-gradient-to-b from-transparent to-accent/40" />
        <div className="flex flex-col items-center gap-2">
          <span className="w-14 h-14 rounded-2xl bg-accent-glow border border-accent/30 flex items-center justify-center shadow-accent-glow-sm">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </span>
          <p className="text-[13px] text-center text-foreground-muted leading-tight max-w-[7rem]">
            Klyp finds the best moments
          </p>
        </div>
        <span className="hidden lg:block w-px h-8 bg-gradient-to-t from-transparent to-accent/40" />
      </div>

      {/* ── Resulting shorts ── */}
      <div>
        <p className="text-[13px] font-semibold text-foreground-muted mb-3">Turned into vertical clips</p>
        <div className="grid grid-cols-3 gap-3">
          {OUTPUTS.map((out) => (
            <div
              key={out.type}
              className="rounded-xl bg-surface/95 backdrop-blur-sm border border-border overflow-hidden"
            >
              {/* 9:16 — the default export format. */}
              <div className="relative bg-gradient-to-b from-surface-2 to-background" style={{ aspectRatio: "9 / 16" }}>
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center">
                    <svg width="11" height="12" viewBox="0 0 16 18" fill="currentColor" className="ml-0.5 text-white">
                      <polygon points="0,0 16,9 0,18" />
                    </svg>
                  </span>
                </span>
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono">
                  {out.ratio}
                </span>
              </div>
              <div className="p-2 space-y-1.5">
                <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wide ${out.style}`}>
                  {out.type}
                </span>
                <p className="text-[11px] text-foreground-muted">{out.caption} captions</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
