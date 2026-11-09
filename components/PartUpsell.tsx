"use client";

import { useEffect } from "react";
import { CAPTION_STYLES, FREE_CAPTION_STYLES } from "@/lib/clips";
import { resultsKeptDays } from "@/lib/results-retention";
import { MONTHLY_PRICE_USD } from "@/lib/pricing";
import { lengthWords } from "@/lib/length-words";
import { trackEvent } from "@/lib/track";

/**
 * Shown under the clips after a free person ran "Clip the best 2 hours" on a longer video: they have just seen what Klyp
 * does, so this is the moment to offer the rest of the stream. Every number comes from the same rules the app uses.
 */
export default function PartUpsell({ totalSeconds, analyzedSeconds }: { totalSeconds: number; analyzedSeconds: number }) {
  useEffect(() => { void trackEvent("results_upsell_view", { hours: Math.round((totalSeconds / 3600) * 10) / 10 }); }, [totalSeconds]);
  const rest = Math.max(0, totalSeconds - analyzedSeconds);
  const extraStyles = CAPTION_STYLES.length - FREE_CAPTION_STYLES.length;
  return (
    <section aria-label="Upgrade to Pro" className="mt-6 flex flex-col gap-5 rounded-2xl border border-accent/40 bg-accent-glow p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="min-w-0 flex-1">
        <h3 className="font-syne text-lg font-bold text-foreground">Want the other {lengthWords(rest)} too?</h3>
        <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
          You clipped the best 2 hours of your stream, which is {lengthWords(totalSeconds)} long. Pro analyzes the whole thing and finds more moments.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-foreground">
          {[
            "The whole stream analyzed, not just 2 hours",
            "No Klyp watermark on your downloads",
            `${extraStyles} more caption styles`,
            `Clips kept ${resultsKeptDays(true)} days instead of ${resultsKeptDays(false)}`,
          ].map((line) => (
            <li key={line} className="flex gap-2"><span className="font-bold text-accent" aria-hidden="true">✓</span>{line}</li>
          ))}
        </ul>
      </div>
      <div className="w-full shrink-0 text-center sm:w-56">
        <a
          href="/dashboard/upgrade"
          onClick={() => void trackEvent("results_upsell_click", { hours: Math.round((totalSeconds / 3600) * 10) / 10 })}
          className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-background transition-colors hover:bg-accent-dim"
        >
          Get Pro
        </a>
        <p className="mt-2 text-xs text-foreground-muted">${MONTHLY_PRICE_USD} a month. Cancel anytime.</p>
        <p className="mt-1 text-xs text-amber-300">Your free clips are saved for {resultsKeptDays(false)} days.</p>
      </div>
    </section>
  );
}
