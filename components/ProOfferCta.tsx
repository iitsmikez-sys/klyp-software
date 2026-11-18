"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/track";
import { rawOfferCopy, rawOfferFrom, type RawOffer } from "@/lib/raw-pro";

/**
 * The call to action for a Pro pitch inside a pop-up. If this person is offered the 4-day pass (or the $17 first month)
 * it shows that and starts checkout in one click; otherwise it is a plain link to the Pro plans. The $28 and the
 * cancel rule are always stated. `source` is recorded so we can see which pop-up the click came from.
 */
export default function ProOfferCta({ source, fallbackLabel }: { source: string; fallbackLabel: string }) {
  const [offer, setOffer] = useState<RawOffer>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stripe/checkout").then((r) => r.json()).then((data) => { if (!cancelled) setOffer(rawOfferFrom(data)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const copy = rawOfferCopy(offer);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void trackEvent("upgrade_click", { interval: "month", first_month: offer.kind === "first_month", trial: offer.kind === "trial", source });
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval: "month" }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `Checkout failed (HTTP ${res.status}).`);
      void trackEvent("checkout_started", { interval: "month", source });
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBusy(false);
    }
  };

  if (!copy) {
    return (
      <>
        <a href="/dashboard/upgrade" onClick={() => { void trackEvent("upgrade_link_click", { source }); }} className="mt-3 flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-background transition-colors hover:bg-accent-dim">{fallbackLabel}</a>
        <p className="mt-1.5 text-center text-xs text-foreground-muted">Cancel anytime.</p>
      </>
    );
  }
  return (
    <>
      <div className="mt-3 rounded-lg border border-border bg-background/50 p-3 text-left" data-testid="pro-offer">
        <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
        <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{copy.detail}</p>
      </div>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="mt-3 flex min-h-10 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-background transition-colors hover:bg-accent-dim disabled:opacity-60"
      >
        {busy ? "Opening checkout…" : copy.button}
      </button>
      {error && <p role="alert" className="mt-1.5 text-center text-xs text-red-400">{error}</p>}
      <p className="mt-1.5 text-center text-xs text-foreground-muted">
        <a href="/dashboard/upgrade" className="underline underline-offset-2 hover:text-foreground">See all Pro plans</a>
      </p>
    </>
  );
}
