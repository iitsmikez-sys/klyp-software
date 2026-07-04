"use client";

import { useSparks } from "./SparksProvider";

export function SparkIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

/** Premium Sparks balance pill — lives top-right of the dashboard header. */
export default function SparksBalance() {
  const { balance } = useSparks();

  return (
    <div className="flex items-center gap-2.5 pl-3.5 pr-4 py-2 rounded-full bg-surface border border-accent/25 shadow-accent-glow-sm">
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-accent-glow text-accent">
        <SparkIcon size={14} />
      </span>
      <div className="flex items-baseline gap-1.5">
        {balance === null ? (
          <span className="w-8 h-5 rounded bg-surface-2 animate-pulse" />
        ) : (
          <span
            className={`font-syne text-lg font-bold leading-none ${
              balance === 0 ? "text-red-400" : "text-foreground"
            }`}
          >
            {balance}
          </span>
        )}
        <span className="text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
          Sparks
        </span>
      </div>
    </div>
  );
}
