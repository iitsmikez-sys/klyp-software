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
      button: `${offer.days}-day Pro pass: ${dollars(offer.cents)}`,
      fine: `${offer.days} days of Pro, then $28 a month unless you cancel first. Cancel any time.`,
    };
  }
  if (offer.kind === "first_month") {
    return { button: `First month of Pro: ${dollars(offer.cents)}`, fine: "After the first month it is $28 a month. Cancel any time." };
  }
  return { button: "Unlock with Pro, $28 a month", fine: "Billed monthly. Cancel any time." };
}

/** A glossy open padlock (orange), drawn inline so it looks the same on every device. */
function OpenPadlock() {
  return (
    <svg width="76" height="90" viewBox="0 -6 76 90" aria-hidden="true" className="drop-shadow-[0_8px_18px_rgba(255,150,40,0.35)]">
      <defs>
        <linearGradient id="lock-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffc15a" /><stop offset="1" stopColor="#f2780c" /></linearGradient>
        <linearGradient id="lock-shackle" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f1f1f6" /><stop offset="1" stopColor="#9a9aae" /></linearGradient>
      </defs>
      <path d="M22 38 V24 C22 10 33 3 44 3 C55 3 62 10 62 21 V30" fill="none" stroke="url(#lock-shackle)" strokeWidth="9" strokeLinecap="round" />
      <rect x="6" y="36" width="64" height="44" rx="12" fill="url(#lock-body)" />
      <rect x="6" y="36" width="64" height="14" rx="12" fill="#fff" opacity="0.18" />
      <circle cx="38" cy="55" r="6.5" fill="#3b2410" />
      <rect x="35" y="57" width="6" height="14" rx="3" fill="#3b2410" />
    </svg>
  );
}

/**
 * Shown to a Free account under its unlocked clips: the rest of the clips the analysis found, with their scores but the titles
 * blurred. The offer sits beside the list on a computer and under it on a phone. The button goes straight to checkout (the Pro
 * pass, or the plain plan if the pass was already used), and the clips unlock with no extra Sparks because the analysis is
 * already paid for.
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
    <section
      data-locked-clips
      aria-label="More clips with Pro"
      className="mt-6 overflow-hidden rounded-2xl border border-border p-4 sm:p-6"
      style={{ background: "radial-gradient(circle at 85% 20%, rgba(0,229,160,0.16), transparent 55%), #0e0f12" }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-xl border border-border bg-surface/80 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <p className="mb-3 text-[13px] text-foreground-muted">{count} more {count === 1 ? "clip" : "clips"} found. Your best {FREE_TOP_UNLOCKED} are unlocked above.</p>
          <ul className="space-y-2">
            {clips.map((clip, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg bg-background/60 px-3 py-3 text-sm text-foreground-muted">
                <span aria-hidden="true" className="text-base">🔒</span>
                <span className="sr-only">Locked clip.</span>
                <span aria-hidden="true" className="min-w-0 flex-1 select-none truncate blur-[3px]">{clip.title}</span>
                <span className="tabular-nums" aria-label={`Score ${Math.round(clip.score)}`}>{Math.round(clip.score)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col items-center text-center">
          <OpenPadlock />
          <h3 className="mt-3 font-syne text-xl font-extrabold leading-tight text-foreground sm:text-2xl">Unlock every clip</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">Pro opens the rest, with no extra Sparks.</p>
          <button
            type="button"
            data-unlock-checkout
            onClick={() => void start()}
            disabled={busy}
            className="mt-4 flex min-h-12 w-full max-w-xs items-center justify-center rounded-xl bg-accent px-5 text-base font-bold text-background transition-colors hover:bg-accent-dim disabled:opacity-60"
          >
            {busy ? "Opening checkout…" : words.button}
          </button>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-foreground-muted">{words.fine}</p>
          {error && (
            <p role="alert" className="mt-2 max-w-xs text-xs text-red-400">
              {error} <a href="/dashboard/upgrade?need=unlock" className="underline underline-offset-2">See the Pro plans</a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
