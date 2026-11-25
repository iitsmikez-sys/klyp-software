"use client";

import { useEffect, useState } from "react";
import { useSparks } from "@/components/SparksProvider";
import ProOfferCta from "@/components/ProOfferCta";
import { trackEvent } from "@/lib/track";
import { rawOfferFrom, type RawOffer } from "@/lib/raw-pro";
import { PASS_REASONS, POPUP_DELAY_MS, shouldShowPassPopup, type PassReason } from "@/lib/pass-popup";
import { blackFridayActive } from "@/lib/black-friday";

const STORAGE_KEY = "klyp-pass-popup-closed-at";
/** The picture in the pop-up. If the file is not there, a plain Klyp banner is shown instead. */
export const POPUP_IMAGE = "/pass-popup.png";

function readClosedAt(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

/** The pop-up itself (the picture, the words, the one-click offer and the ways to close it). Split out so it can be drawn on its own. */
export function PassPopupDialog({ onClose, onAnswer, startAsking = false }: {
  onClose: (how: "not_now" | "escape" | "backdrop" | "x") => void;
  /** Called when the person taps a reason in the one-tap question after "Not now". */
  onAnswer?: (reason: PassReason) => void;
  /** Draw the one-tap question straight away (for the preview). */
  startAsking?: boolean;
}) {
  const [imageOk, setImageOk] = useState(true);
  const [step, setStep] = useState<"offer" | "ask" | "thanks">(startAsking ? "ask" : "offer");
  const close = onClose;
  const answer = (reason: PassReason) => {
    onAnswer?.(reason);
    setStep("thanks");
    window.setTimeout(() => close("not_now"), 1400);
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4" data-pass-popup onClick={() => close("backdrop")}>
      <div role="dialog" aria-modal="true" aria-labelledby="pass-popup-title" onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <button type="button" aria-label="Close" onClick={() => close("x")}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-foreground-muted transition-colors hover:text-foreground">✕</button>
        {imageOk
          ? <img src={POPUP_IMAGE} alt="" onError={() => setImageOk(false)} className="h-auto w-full object-cover" />
          : <div className="flex h-28 items-center justify-center bg-accent-glow font-syne text-3xl font-bold text-foreground">kl<span className="text-accent">yp</span></div>}
        <div className="p-6">
          {step === "offer" && (
            <>
              <h3 id="pass-popup-title" className="font-syne text-xl font-bold text-foreground">Get every clip, no watermark</h3>
              <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
                Try Pro and unlock all the clips Klyp finds, download them clean, and clip longer videos.
              </p>
              <ProOfferCta source="pass_popup" fallbackLabel="See the Pro plans" />
              <button type="button" data-pass-popup-not-now onClick={() => setStep("ask")}
                className="mt-3 w-full text-center text-[13px] text-foreground-muted underline underline-offset-2 hover:text-foreground">Not now</button>
            </>
          )}
          {step === "ask" && (
            <div data-pass-popup-ask>
              <h3 id="pass-popup-title" className="font-syne text-xl font-bold text-foreground">What stopped you?</h3>
              <p className="mt-1 text-sm leading-relaxed text-foreground-muted">One tap helps us make Klyp better.</p>
              <div className="mt-4 grid gap-2">
                {PASS_REASONS.map((reason) => (
                  <button key={reason.id} type="button" data-pass-reason={reason.id} onClick={() => answer(reason.id)}
                    className="flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background/60 px-4 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent-glow">
                    {reason.label}
                  </button>
                ))}
              </div>
              <button type="button" data-pass-popup-skip onClick={() => close("not_now")}
                className="mt-3 w-full text-center text-[13px] text-foreground-muted underline underline-offset-2 hover:text-foreground">Skip</button>
            </div>
          )}
          {step === "thanks" && (
            <div data-pass-popup-thanks className="py-6 text-center">
              <h3 id="pass-popup-title" className="font-syne text-xl font-bold text-foreground">Thanks, that helps</h3>
              <p className="mt-1 text-sm text-foreground-muted">We read every answer.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The $3 pass pop-up on the dashboard. Free accounts only, only when the account is really offered the pass (or the first month),
 * a few seconds after the page opens, never on top of another dialog, and at most once a day. The button is the same one-click
 * checkout as the other pop-ups, with the $28 and the cancel rule always shown beside it.
 */
export default function PassPopup() {
  const { balance, tier, complimentaryPro } = useSparks();
  const [offer, setOffer] = useState<RawOffer>({ kind: "none" });
  const [open, setOpen] = useState(false);
  const isFree = tier === "free" && !complimentaryPro;
  const loaded = balance !== null;

  useEffect(() => {
    if (!loaded || !isFree) return;
    let cancelled = false;
    fetch("/api/stripe/checkout").then((r) => r.json()).then((data) => { if (!cancelled) setOffer(rawOfferFrom(data)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [loaded, isFree]);

  useEffect(() => {
    if (!shouldShowPassPopup({ loaded, isFree, offer, closedAt: readClosedAt(), now: Date.now() })) return;
    // While the Black Friday box is on the dashboard it is the one offer on screen, so the pass pop-up waits.
    if (blackFridayActive()) return;
    const timer = window.setTimeout(() => {
      // Never on top of another dialog (out of Sparks, long video, and so on).
      if (document.querySelector('[role="dialog"]')) return;
      setOpen(true);
      void trackEvent("pass_popup_view", { offer: offer.kind });
    }, POPUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, isFree, offer]);

  const close = (how: "not_now" | "escape" | "backdrop" | "x") => {
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* the pop-up simply may show again */ }
    void trackEvent("pass_popup_close", { how, offer: offer.kind });
  };

  const answer = (reason: PassReason) => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* the pop-up simply may show again */ }
    void trackEvent("pass_popup_reason", { reason, offer: offer.kind });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close("escape"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return <PassPopupDialog onClose={close} onAnswer={answer} />;
}
