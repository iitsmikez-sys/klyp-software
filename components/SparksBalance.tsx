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

/** Current Sparks balance and refill timing in the dashboard header. */
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
      className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
        <SparkIcon size={16} />
      </span>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        {balance === null ? (
          <span className="w-8 h-5 rounded bg-surface-2 animate-pulse" />
        ) : (
          <span
            className={`font-geist text-xl font-semibold leading-none ${
              balance === 0 ? "text-red-400" : "text-foreground"
            }`}
          >
            {balance}
          </span>
        )}
        <span className="text-xs font-medium text-foreground-muted">
          Sparks
        </span>
      </div>
      {refill && balance !== null && (
        <span className="hidden whitespace-nowrap border-l border-border pl-3 text-xs text-foreground-muted sm:inline">
          {refill}
        </span>
      )}
    </div>
  );
}
