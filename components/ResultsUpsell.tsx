"use client";

import { useEffect } from "react";
import { CAPTION_STYLES, FREE_CAPTION_STYLES } from "@/lib/clips";
import { resultsKeptDays } from "@/lib/results-retention";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { MONTHLY_PRICE_USD } from "@/lib/pricing";
import { trackEvent } from "@/lib/track";

/**
 * Shown under the clips after any free run that was not a "best 2 hours" run (that one has its own box, PartUpsell): they have
 * just seen what Klyp does, so this is when to say what Pro changes. Every line comes from the app's own rules, with no clip
 * counts and no "unlimited".
 */
export default function ResultsUpsell({ clipCount }: { clipCount: number }) {
  useEffect(() => { void trackEvent("results_upsell_view", { kind: "normal" }); }, []);
  const lines = [
    "No Klyp watermark on your downloads",
    `${CAPTION_STYLES.length - FREE_CAPTION_STYLES.length} more caption styles`,
    `Clips kept ${resultsKeptDays(true)} days instead of ${resultsKeptDays(false)}`,
    `Streams up to ${PLAN_LIMITS.pro.youtube / 3600} hours, not just ${PLAN_LIMITS.free.youtube / 3600}`,
  ];
  return (
    <section aria-label="Upgrade to Pro" className="mt-6 rounded-2xl border border-accent/40 bg-accent-glow p-5 sm:p-6">
      <h3 className="font-syne text-lg font-bold text-foreground">
        Like {clipCount === 1 ? "this clip" : `these ${clipCount} clips`}? Make {clipCount === 1 ? "it" : "them"} yours with Pro.
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
        Your free clips carry the Klyp watermark and are kept for {resultsKeptDays(false)} days.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-foreground">
        {lines.map((line) => (
          <li key={line} className="flex gap-2"><span className="font-bold text-accent" aria-hidden="true">✓</span>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href="/dashboard/upgrade"
          onClick={() => void trackEvent("results_upsell_click", { kind: "normal" })}
          className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-6 text-sm font-semibold text-background transition-colors hover:bg-accent-dim"
        >
          Get Pro
        </a>
        <span className="text-xs text-foreground-muted">${MONTHLY_PRICE_USD} a month. Cancel anytime.</span>
      </div>
    </section>
  );
}
