"use client";

type Props = {
  originalStart: number;
  originalEnd: number;
  start: number;
  end: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
};

export default function ClipTrimControl({ originalStart, originalEnd, start, end, disabled, onChange }: Props) {
  const duration = Math.max(0, end - start);
  const originalDuration = originalEnd - originalStart;
  const startOffset = Number((start - originalStart).toFixed(2));
  const endOffset = Math.min(originalDuration, Number((end - originalStart).toFixed(2)));
  const setStart = (value: number) => {
    if (Number.isFinite(value)) onChange(Math.max(originalStart, Math.min(value, end - 0.1)), end);
  };
  const setEnd = (value: number) => {
    if (Number.isFinite(value)) onChange(start, Math.min(originalEnd, Math.max(value, start + 0.1)));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">Trim clip</p>
        <span className="text-[11px] text-accent font-mono">{duration.toFixed(1)}s selected</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-foreground-muted">
          Start in clip (seconds)
          <input type="number" min={0} max={endOffset - 0.1} step="0.01" value={startOffset}
            onChange={(event) => setStart(originalStart + Number(event.target.value))} disabled={disabled}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-foreground disabled:opacity-50" />
          <input aria-label="Trim start" type="range" min={0} max={originalDuration} step="0.01" value={startOffset}
            onChange={(event) => setStart(originalStart + Number(event.target.value))} disabled={disabled} className="mt-1 w-full accent-emerald-400" />
        </label>
        <label className="text-[11px] text-foreground-muted">
          End in clip (seconds)
          <input type="number" min={startOffset + 0.1} max={originalDuration} step="0.01" value={endOffset}
            onChange={(event) => setEnd(originalStart + Number(event.target.value))} disabled={disabled}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-foreground disabled:opacity-50" />
          <input aria-label="Trim end" type="range" min={0} max={originalDuration} step="0.01" value={endOffset}
            onChange={(event) => setEnd(originalStart + Number(event.target.value))} disabled={disabled} className="mt-1 w-full accent-emerald-400" />
        </label>
      </div>
      <p className="text-[10px] text-subtle">Trim stays inside the original clip. Maximum export length: 3 minutes.</p>
    </div>
  );
}
