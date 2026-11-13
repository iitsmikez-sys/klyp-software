"use client";

import { useRef, useState } from "react";
import { fmtWindowClock, fmtWindowLength, snapWindow, tickHours, windowShortcut, type WindowShortcut } from "@/lib/vod-window";

type Props = {
  /** The whole video's length in seconds. The bar covers exactly this. */
  totalSeconds: number;
  /** The most the plan can clip at once, in seconds. */
  capSeconds: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
};

const SHORTCUTS: { id: WindowShortcut; label: string }[] = [
  { id: "first", label: "First" },
  { id: "middle", label: "Middle" },
  { id: "last", label: "Last" },
];

/** A bar for choosing which stretch of a too-long video to clip: two handles, a plan-length cap, shortcuts. */
export default function VodWindowPicker({ totalSeconds, capSeconds, start, end, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "start" | "end" | "move"; grab: number } | null>(null);
  const [limitNote, setLimitNote] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capHours = capSeconds / 3600;

  const secondsAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * totalSeconds;
  };
  const flashLimit = () => {
    setLimitNote(true);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setLimitNote(false), 1800);
  };
  const apply = (kind: "start" | "end" | "move", seconds: number, grab: number) => {
    const next = snapWindow({ kind, seconds, grab, start, end, totalSeconds, capSeconds });
    if (next.hitCap) flashLimit();
    if (next.start !== start || next.end !== end) onChange(next.start, next.end);
  };
  const begin = (kind: "start" | "end" | "move") => (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, grab: kind === "move" ? secondsAt(event.clientX) - start : 0 };
  };
  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    apply(drag.current.kind, secondsAt(event.clientX), drag.current.grab);
  };
  const finish = () => { drag.current = null; };
  const onTrackDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = secondsAt(event.clientX);
    if (at >= start && at <= end) {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { kind: "move", grab: at - start };
    } else {
      const half = (end - start) / 2;
      apply("move", at, half);
    }
  };
  const onKey = (kind: "start" | "end") => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 3600 : 300;
    const dir = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    event.preventDefault();
    apply(kind, (kind === "start" ? start : end) + dir * step, 0);
  };

  const pctStart = (start / totalSeconds) * 100;
  const pctEnd = (end / totalSeconds) * 100;
  const ticks = tickHours(totalSeconds);
  const length = end - start;
  const activeShortcut = SHORTCUTS.find((s) => {
    const w = windowShortcut(s.id, totalSeconds, capSeconds);
    return w.start === start && w.end === end;
  })?.id;

  return (
    <div className="mt-2 rounded-xl border border-accent/30 bg-accent-glow p-4" data-testid="vod-window-picker">
      <p className="text-sm font-semibold text-foreground">Pick the part to clip</p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
        This video is {fmtWindowLength(totalSeconds)}. Your plan clips up to {capHours} hours at a time. Drag the handles, or pick a shortcut.
      </p>

      <div className="px-3 pb-1 pt-10">
        <div ref={trackRef} onPointerDown={onTrackDown} onPointerMove={onMove} onPointerUp={finish} className="relative h-10 cursor-pointer touch-none select-none">
          <div className="absolute inset-x-0 top-3 h-4 rounded-full bg-surface-2" />
          <div className="absolute top-3 h-4 rounded-full bg-accent shadow-[0_0_14px_rgba(0,229,160,0.5)]" style={{ left: `${pctStart}%`, width: `${pctEnd - pctStart}%` }} />
          {(["start", "end"] as const).map((kind) => {
            const at = kind === "start" ? pctStart : pctEnd;
            const value = kind === "start" ? start : end;
            return (
              <div
                key={kind}
                role="slider"
                tabIndex={0}
                aria-label={kind === "start" ? "Start of the part to clip" : "End of the part to clip"}
                aria-valuemin={0}
                aria-valuemax={Math.round(totalSeconds)}
                aria-valuenow={Math.round(value)}
                aria-valuetext={fmtWindowClock(value)}
                onPointerDown={begin(kind)}
                onPointerMove={onMove}
                onPointerUp={finish}
                onKeyDown={onKey(kind)}
                className="absolute top-0 h-10 w-0 cursor-ew-resize touch-none outline-none"
                style={{ left: `${at}%` }}
              >
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-xs font-bold tabular-nums text-background">{fmtWindowClock(value)}</span>
                <span className="absolute top-0 h-10 w-[3px] -translate-x-1/2 rounded bg-accent" />
                <span className="absolute left-1/2 top-1 flex h-8 w-5 -translate-x-1/2 items-center justify-center gap-[3px] rounded-full bg-foreground shadow-md ring-2 ring-accent/40 focus-visible:ring-4">
                  <i className="block h-3.5 w-[2px] rounded bg-background/50" />
                  <i className="block h-3.5 w-[2px] rounded bg-background/50" />
                </span>
              </div>
            );
          })}
        </div>
        <div className="relative mt-1 h-4">
          {ticks.map((hour) => (
            <span key={hour} className="absolute -translate-x-1/2 text-[11px] tabular-nums text-foreground-muted" style={{ left: `${((hour * 3600) / totalSeconds) * 100}%` }}>{hour}h</span>
          ))}
          <span className="absolute right-0 whitespace-nowrap text-[11px] font-semibold tabular-nums text-foreground">{fmtWindowLength(totalSeconds)}</span>
        </div>
      </div>

      <p className="h-4 text-center text-xs text-accent" aria-live="polite">{limitNote ? `${capHours} hour limit: the window stops here` : ""}</p>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {SHORTCUTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { const w = windowShortcut(s.id, totalSeconds, capSeconds); onChange(w.start, w.end); }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${activeShortcut === s.id ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border text-foreground-muted hover:border-subtle"}`}
          >
            {s.label} {capHours}h
          </button>
        ))}
        <span className="ml-auto text-xs text-foreground-muted">Selected <b className="text-foreground">{fmtWindowLength(length)}</b></span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-foreground-muted">Clip times match the full video: a moment at 9:30 stays 9:30. Want another part? Run another window afterwards.</p>
    </div>
  );
}
