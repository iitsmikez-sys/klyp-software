"use client";

import { useEffect } from "react";
import { CAPTION_STYLES, FREE_CAPTION_STYLES } from "@/lib/clips";
import { resultsKeptDays } from "@/lib/results-retention";
import { trackEvent } from "@/lib/track";

/**
 * One calm line under a free account's Saved Clips on the dashboard, the page people come back to. Every number comes from the
 * app's own rules; it shows no price (the button opens the upgrade page, which has the real one) and no promise about results.
 */
export default function DashboardUpsell() {
  useEffect(() => { void trackEvent("dashboard_upsell_view"); }, []);
  return (
    <aside aria-label="Upgrade to Pro" className="mt-4 flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent-glow px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Your free clips are kept for {resultsKeptDays(false)} days.</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
          Pro keeps them {resultsKeptDays(true)} days, removes the Klyp watermark from your downloads, and adds {CAPTION_STYLES.length - FREE_CAPTION_STYLES.length} more caption styles.
        </p>
      </div>
      <a
        href="/dashboard/upgrade"
        onClick={() => void trackEvent("dashboard_upsell_click")}
        className="flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-background transition-colors hover:bg-accent-dim"
      >
        Get Pro
      </a>
    </aside>
  );
}
