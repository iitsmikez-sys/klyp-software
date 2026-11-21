"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/track";
import { FREE_TOP_UNLOCKED } from "@/lib/free-taste";
import { dollars, rawOfferFrom, type RawOffer } from "@/lib/raw-pro";

export type LockedClip = { title: string; score: number };

/** The button and the fine print for what this person is offered right now. The $28 and the cancel rule are always stated. */
function offerWords(offer: RawOffer): { button: string; fine: string } {
  if (offer.kind === "trial") {
    return {
      button: `Unlock all for ${dollars(offer.cents)}`,
      fine: `${offer.days} days of Pro, then $28 a month unless you cancel first. Cancel any time.`,
    };
  }
  if (offer.kind === "first_month") {
    return { button: `Unlock all, first month ${dollars(offer.cents)}`, fine: "After the first month it is $28 a month. Cancel any time." };
  }
  return { button: "Unlock all with Pro, $28 a month", fine: "Billed monthly. Cancel any time." };
}

/**
 * Shown to a Free account under its unlocked clips: the rest of the clips the analysis found, with their titles and scores but no
 * way to open them. The button goes straight to checkout (the Pro pass, or the plain plan if the pass was already used), and the
 * clips unlock with no extra Sparks because the analysis is already paid for.
 */
export default function LockedClips({ clips }: { clips: LockedClip[] }) {
  const count = clips.length;
  const [offer, setOffer] = useState<RawOffer>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (count > 0) void trackEvent("locked_clips_view", { locked: count }); }, [count]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stripe/checkout").then((r) => r.json()).then((data) => { if (!cancelled) setOffer(rawOfferFrom(data)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void trackEvent("locked_clips_click", { locked: count, offer: offer.kind });
    void trackEvent("upgrade_click", { interval: "month", first_month: offer.kind === "first_month", trial: offer.kind === "trial", source: "locked_clips" });
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval: "month" }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `Checkout failed (HTTP ${res.status}).`);
      void trackEvent("checkout_started", { interval: "month", source: "locked_clips" });
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBusy(false);
    }
  };

  if (count === 0) return null;
  const words = offerWords(offer);
  return (
    <section data-locked-clips aria-label="More clips with Pro" className="mt-6 rounded-2xl border border-accent/40 bg-accent-glow p-5">
      <h3 className="font-syne text-lg font-bold text-foreground">{count} more {count === 1 ? "clip" : "clips"} found</h3>
      <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
        Your best {FREE_TOP_UNLOCKED} are unlocked above. Pro unlocks the rest, with no extra Sparks.
      </p>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2/60 text-sm">
        {clips.map((clip, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2.5 text-foreground-muted">
            <span aria-hidden="true">🔒</span>
            <span className="min-w-0 flex-1 truncate">{clip.title}</span>
            <span className="tabular-nums">{Math.round(clip.score)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-unlock-checkout
          onClick={() => void start()}
          disabled={busy}
          className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-background transition-colors hover:bg-accent-dim disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : words.button}
        </button>
        <span className="text-xs text-foreground-muted">{words.fine}</span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error} <a href="/dashboard/upgrade?need=unlock" className="underline underline-offset-2">See the Pro plans</a>
        </p>
      )}
    </section>
  );
}
