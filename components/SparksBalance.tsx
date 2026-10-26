"use client";

import { useSparks } from "./SparksProvider";
import { refillPhrase, vodsPhrase } from "@/lib/sparks";

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
  const { balance, resetAt } = useSparks();

  // A bare number says nothing about when it comes back or what it buys. The
  // refill is the more urgent of the two, so it sits inline and the plainer
  // "about 3 VODs" reading goes in the tooltip, where it does not crowd the
  // pill on a narrow header.
  const refill = refillPhrase(resetAt);
  const title =
    balance === null
      ? undefined
      : `${balance} Sparks — ${vodsPhrase(balance)}${refill ? `, ${refill}` : ""}`;

  return (
    <div
      title={title}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2"
    >
      <span className="flex items-center justify-center w-7 h-7 rounded-md bg-accent-glow text-accent">
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
      {refill && balance !== null && (
        <span className="hidden sm:inline text-[11px] text-foreground-muted border-l border-border pl-2.5 whitespace-nowrap">
          {refill}
        </span>
      )}
    </div>
  );
}
