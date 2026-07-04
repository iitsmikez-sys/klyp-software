"use client";

import { useState } from "react";
import Link from "next/link";
import { useSparks } from "./SparksProvider";
import { SparkIcon } from "./SparksBalance";

/**
 * Dashboard header CTA: free users get "Upgrade to Pro" (links to the in-app
 * pricing page), Pro users get "Manage billing" (Stripe customer portal).
 */
export default function UpgradeButton() {
  const { tier } = useSparks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tier !== "pro") {
    return (
      <Link
        href="/dashboard/upgrade"
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm whitespace-nowrap"
      >
        <SparkIcon size={13} />
        Upgrade to Pro
      </Link>
    );
  }

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={openPortal}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface border border-border text-sm font-bold font-syne text-foreground-muted hover:border-subtle transition-colors disabled:opacity-60 whitespace-nowrap"
      >
        {busy && (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        )}
        Manage billing
      </button>
      {error && <p className="text-[11px] text-red-400 max-w-[240px] text-right">{error}</p>}
    </div>
  );
}
