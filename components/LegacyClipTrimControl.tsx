"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { updateClipTrim } from "@/lib/clip-trim";

type Handle = "start" | "end";

type Props = {
  originalStart: number;
  originalEnd: number;
  start: number;
  end: number;
  playhead?: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
};

const formatTime = (seconds: number) => {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  return `${minutes}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
};

export default function ClipTrimControl({ originalStart, originalEnd, start, end, playhead, disabled, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const originalDuration = originalEnd - originalStart;
  const usable = !disabled && originalDuration >= 0.1;
  const startOffset = start - originalStart;
  const endOffset = end - originalStart;
  const percent = (seconds: number) => `${originalDuration > 0 ? Math.max(0, Math.min(100, seconds / originalDuration * 100)) : 0}%`;

  const update = (handle: Handle, value: number) => {
    if (!usable || !Number.isFinite(value)) return;
    const next = updateClipTrim(originalStart, originalEnd, start, end, handle, value);
    onChange(next.start, next.end);
  };

  const updateFromPointer = (handle: Handle, clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    update(handle, originalStart + fraction * originalDuration);
  };

  const onPointerDown = (handle: Handle, event: PointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    updateFromPointer(handle, event.clientX);
  };

  const onPointerMove = (handle: Handle, event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(handle, event.clientX);
  };

  const onKeyDown = (handle: Handle, event: KeyboardEvent<HTMLDivElement>) => {
    if (!usable) return;
    const value = handle === "start" ? start : end;
    const step = event.shiftKey ? 1 : 0.1;
    const next = event.key === "ArrowLeft" || event.key === "ArrowDown" ? value - step
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? value + step
      : event.key === "Home" ? originalStart : event.key === "End" ? originalEnd : null;
    if (next === null) return;
    event.preventDefault();
    update(handle, next);
  };

  return (
    <div className="space-y-2" aria-label="Trim clip">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">Trim clip</p>
        <span className="text-[11px] text-accent font-mono" aria-live="polite">{(end - start).toFixed(1)}s selected</span>
      </div>
      <div ref={trackRef} className="relative h-10 mx-2 touch-none select-none" aria-label="Clip timeline">
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-surface-2 border border-border" />
        <div className="absolute top-4 h-2 rounded-full bg-accent/60"
          style={{ left: percent(startOffset), width: percent(end - start) }} />
        {playhead !== undefined && Number.isFinite(playhead) && (
          <div aria-hidden className="absolute top-1 h-8 w-px bg-white/70 pointer-events-none"
            style={{ left: percent(playhead) }} />
        )}
        {(["start", "end"] as const).map((handle) => {
          const offset = handle === "start" ? startOffset : endOffset;
          const min = handle === "start" ? 0 : startOffset + 0.1;
          const max = handle === "start" ? endOffset - 0.1 : originalDuration;
          return (
            <div key={handle} role="slider" tabIndex={usable ? 0 : -1}
              aria-label={`Trim ${handle}`} aria-disabled={!usable}
              aria-valuemin={Number(min.toFixed(2))} aria-valuemax={Number(max.toFixed(2))}
              aria-valuenow={Number(offset.toFixed(2))} aria-valuetext={formatTime(offset)}
              onPointerDown={(event) => onPointerDown(handle, event)}
              onPointerMove={(event) => onPointerMove(handle, event)}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
              onKeyDown={(event) => onKeyDown(handle, event)}
              className={`absolute top-1 h-8 w-3 -translate-x-1/2 rounded border-2 border-background bg-accent shadow-md focus:outline-none focus:ring-2 focus:ring-white ${usable ? "cursor-ew-resize" : "opacity-50"}`}
              style={{ left: percent(offset) }} />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-subtle">
        <span>Start {formatTime(startOffset)}</span><span>End {formatTime(endOffset)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-foreground-muted">Start (seconds)
          <input type="number" min={0} max={Math.max(0, endOffset - 0.1)} step="0.1" value={Number(startOffset.toFixed(2))}
            onChange={(event) => update("start", originalStart + Number(event.target.value))} disabled={!usable}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-foreground disabled:opacity-50" />
        </label>
        <label className="text-[11px] text-foreground-muted">End (seconds)
          <input type="number" min={Number((startOffset + 0.1).toFixed(2))} max={originalDuration} step="0.1" value={Number(endOffset.toFixed(2))}
            onChange={(event) => update("end", originalStart + Number(event.target.value))} disabled={!usable}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-foreground disabled:opacity-50" />
        </label>
      </div>
      <p className="text-[10px] text-subtle">Drag either handle or use arrow keys. The original clip stays available.</p>
    </div>
  );
}
