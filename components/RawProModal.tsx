"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/track";
import { RAW_PRO_BODY, RAW_PRO_TITLE, rawOfferCopy, rawOfferFrom, type RawOffer } from "@/lib/raw-pro";

/**
 * Shown when a Free member taps Download Raw: Raw is the clean cut with no watermark, a Pro feature.
 * If the person is offered the 4-day pass (or the $17 first month) it is shown here and can be started in one click;
 * otherwise they go to the Pro plans page.
 */
export default function RawProModal({ onClose }: { onClose: () => void }) {
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
    void trackEvent("upgrade_click", { interval: "month", first_month: offer.kind === "first_month", trial: offer.kind === "trial", source: "raw_pro_modal" });
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval: "month" }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `Checkout failed (HTTP ${res.status}).`);
      void trackEvent("checkout_started", { interval: "month", source: "raw_pro_modal" });
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="raw-pro-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm animate-fade-in rounded-2xl border border-accent/40 bg-surface p-7 text-center shadow-accent-glow">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">Pro feature</p>
        <h3 id="raw-pro-title" className="mt-1 font-syne text-xl font-bold text-foreground">{RAW_PRO_TITLE}</h3>
        <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{RAW_PRO_BODY}</p>
        {copy ? (
          <>
            <div className="mt-4 rounded-xl border border-border bg-background/60 p-3 text-left" data-testid="raw-offer">
              <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
              <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{copy.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className="mt-4 block w-full rounded-xl bg-accent py-2.5 font-syne text-sm font-bold text-background shadow-accent-glow-sm transition-colors hover:bg-accent-dim disabled:opacity-60"
            >
              {busy ? "Opening checkout…" : copy.button}
            </button>
            {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
          </>
        ) : (
          <a
            href="/dashboard/upgrade"
            className="mt-6 block w-full rounded-xl bg-accent py-2.5 font-syne text-sm font-bold text-background shadow-accent-glow-sm transition-colors hover:bg-accent-dim"
          >
            See Pro plans
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
