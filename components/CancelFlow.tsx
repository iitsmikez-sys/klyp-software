"use client";

import { useCallback, useEffect, useState } from "react";
import { SPARKS_ALLOWANCE } from "@/lib/tier";
import { addMonthsUtc, DISCOUNTED_CENTS, RETENTION, type Reason, type SubReason } from "@/lib/retention-core";

type State = {
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paused: boolean;
  discountEligible: boolean;
  discountAvailableOn: string | null;
  nextAmountCents: number;
};
type Step = "survey" | "offer" | "confirm_cancel" | "done_pause" | "done_discount" | "done_cancel";
type Done = { proUntil?: string; resumesOn?: string; accessUntil?: string; nextBillingDate?: string };

const REASON_OPTIONS: { id: Reason; label: string }[] = [
  { id: "not_good_clips", label: "I'm not finding good enough clips." },
  { id: "break", label: "I'm taking a break from streaming." },
  { id: "too_expensive", label: "It's too expensive." },
  { id: "not_using", label: "I'm not using Klyp enough." },
  { id: "other", label: "Something else." },
];
const SUB_OPTIONS: { id: SubReason; label: string }[] = [
  { id: "not_entertaining", label: "Clips aren't entertaining enough." },
  { id: "missing_moments", label: "Klyp is missing important moments." },
  { id: "cut_off", label: "Clips cut off the punchline or reaction." },
  { id: "other", label: "Other." },
];
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "the end of your billing period";

async function call<T>(action: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  const res = await fetch(`/api/retention/${action}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const choice = (on: boolean) =>
  `flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
    on ? "border-accent/60 bg-accent/10 text-foreground" : "border-border bg-surface-2 text-foreground-muted hover:border-subtle hover:text-foreground"}`;
const primary = "w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold font-syne text-background transition-colors hover:bg-accent-dim disabled:opacity-50";
const secondary = "w-full rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-subtle disabled:opacity-50";
const quiet = "w-full py-2 text-center text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50";

export default function CancelFlow({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [step, setStep] = useState<Step>("survey");
  const [reason, setReason] = useState<Reason | null>(null);
  const [subReason, setSubReason] = useState<SubReason | null>(null);
  const [detail, setDetail] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [months, setMonths] = useState<1 | 2>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done>({});

  const loadState = useCallback(async () => {
    const r = await call<State>("state");
    if (r.ok) setState(r.data);
    else setError(r.data.error ?? "Couldn't load your subscription. You can still continue.");
  }, []);
  useEffect(() => { void loadState(); }, [loadState]);

  const run = async <T,>(label: string, action: string, body: unknown, onOk: (data: T) => void) => {
    setBusy(label); setError(null);
    try {
      const r = await call<T>(action, body);
      if (r.ok) onOk(r.data);
      else setError(r.data.error ?? "Something went wrong. Nothing was changed.");
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
    } finally { setBusy(null); }
  };

  const submitSurvey = () => {
    if (!reason) return;
    void run<{ eventId: string }>("Saving…", "survey", { reason, subReason: reason === "not_good_clips" ? subReason : null, detail }, (d) => {
      setEventId(d.eventId);
      setStep("offer");
    });
  };
  const goCancel = () => { setError(null); setStep("confirm_cancel"); };

  const pauseDates = state?.periodEnd
    ? { proUntil: state.periodEnd, resumes: new Date(addMonthsUtc(Math.floor(new Date(state.periodEnd).getTime() / 1000), months) * 1000).toISOString() }
    : null;

  const renderOffer = () => {
    if (!reason) return null;
    const pauseCard = (
      <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
        <p className="text-sm font-semibold text-foreground">Pause your subscription</p>
        <div className="grid grid-cols-2 gap-2">
          {([1, 2] as const).map((m) => (
            <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)} className={choice(months === m)}>{m} month{m > 1 ? "s" : ""}</button>
          ))}
        </div>
        {pauseDates && (
          <p className="text-xs leading-relaxed text-foreground-muted">
            You keep Pro until <b className="text-foreground">{day(pauseDates.proUntil)}</b>. After that you won&apos;t be billed and your
            account and saved clips stay put (Free plan). Billing resumes on <b className="text-foreground">{day(pauseDates.resumes)}</b> at{" "}
            <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}</b>, with a fresh {SPARKS_ALLOWANCE.pro} Sparks. Stripe emails you before it resumes.
          </p>
        )}
        <button type="button" className={primary} disabled={!!busy || !state || state.paused || state.cancelAtPeriodEnd}
          onClick={() => void run<Done>("Confirming with Stripe…", "pause", { eventId, months }, (d) => { setDone(d); setStep("done_pause"); void loadState(); })}>
          {busy ? busy : "Pause my subscription"}
        </button>
        {state?.paused && <p className="text-xs text-foreground-muted">Your subscription is already paused.</p>}
        {state?.cancelAtPeriodEnd && <p className="text-xs text-foreground-muted">Your cancellation is already scheduled. Undo it first to pause.</p>}
      </div>
    );
    return (
      <div className="space-y-3">
        {reason === "not_good_clips" && (
          <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">
            <p className="font-semibold text-foreground">Thanks, that helps us fix it.</p>
            <p>Your answer was sent to the team. Meanwhile, two things often help: pick the right content type (Gaming or IRL) and add a topic keyword in Clip Settings. Klyp only returns moments that clear its quality bar, so weak videos return fewer clips.</p>
            <p>Want us to look at a specific video? Reply to any Klyp email with the link and what went wrong.</p>
          </div>
        )}
        {reason === "break" && pauseCard}
        {reason === "not_using" && (
          <>
            <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">
              <p className="font-semibold text-foreground">A few things worth trying</p>
              <p>Automatic clipping after every Twitch stream, the timeline editor with captions, and direct uploads for videos from anywhere.</p>
            </div>
            {pauseCard}
          </>
        )}
        {reason === "too_expensive" && (state?.discountEligible ? (
          <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
            <p className="text-sm font-semibold text-foreground">40% off your next payment</p>
            <p className="text-sm text-foreground">
              <b>{usd(DISCOUNTED_CENTS)}</b> once, then <b>{usd(RETENTION.PRICE_CENTS)}/month</b>
            </p>
            <p className="text-xs text-foreground-muted">
              Applies to your payment on {day(state.periodEnd)}.
            </p>
            <button type="button" className={primary} disabled={!!busy}
              onClick={() => void run<Done>("Confirming with Stripe…", "discount", { eventId }, (d) => { setDone(d); setStep("done_discount"); void loadState(); })}>
              {busy ? busy : "Apply 40% off"}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">
            {state?.discountAvailableOn
              ? <>You've used this offer recently. It's available again on <b className="text-foreground">{day(state.discountAvailableOn)}</b>.</>
              : <>The discount can't be applied to this subscription right now.</>}
          </div>
        ))}
        {reason === "other" && (
          <p className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">Thanks for telling us. Your feedback was saved.</p>
        )}
        <button type="button" className={secondary} disabled={!!busy} onClick={onClose}>Keep my subscription</button>
        <button type="button" className={quiet} disabled={!!busy} onClick={goCancel}>No thanks, continue cancellation</button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} role="dialog" aria-modal="true" aria-label="Cancel your subscription">
      <div className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        {step === "survey" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Before you go, why are you thinking about cancelling Klyp?</h2>
            <div className="space-y-2">
              {REASON_OPTIONS.map((o) => (
                <button key={o.id} type="button" aria-pressed={reason === o.id} className={choice(reason === o.id)} onClick={() => { setReason(o.id); setSubReason(null); }}>{o.label}</button>
              ))}
            </div>
            {reason === "not_good_clips" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground-muted">What went wrong?</p>
                {SUB_OPTIONS.map((o) => (
                  <button key={o.id} type="button" aria-pressed={subReason === o.id} className={choice(subReason === o.id)} onClick={() => setSubReason(o.id)}>{o.label}</button>
                ))}
              </div>
            )}
            {reason && (
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} rows={3}
                placeholder={reason === "not_using" ? "What would make Klyp more useful? (optional)" : "Anything else you'd like to tell us? (optional)"}
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:border-accent/60 focus:outline-none" />
            )}
            <button type="button" className={primary} disabled={!reason || !!busy} onClick={submitSurvey}>{busy ?? "Continue"}</button>
            <button type="button" className={secondary} disabled={!!busy} onClick={onClose}>Keep my subscription</button>
            <button type="button" className={quiet} disabled={!!busy} onClick={goCancel}>Skip and continue cancellation</button>
          </>
        )}
        {step === "offer" && renderOffer()}
        {step === "confirm_cancel" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Cancel your subscription?</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Your subscription will end on <b className="text-foreground">{day(state?.periodEnd)}</b>. You keep Pro and your Sparks until then, and your
              saved clips stay available. You won&apos;t be charged again.
            </p>
            <button type="button" className={primary} disabled={!!busy}
              onClick={() => void run<Done>("Confirming with Stripe…", "cancel", { eventId }, (d) => { setDone(d); setStep("done_cancel"); void loadState(); })}>
              {busy ?? "Confirm cancellation"}
            </button>
            <button type="button" className={secondary} disabled={!!busy} onClick={onClose}>Keep my subscription</button>
          </>
        )}
        {step === "done_pause" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Your subscription is paused</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Stripe confirmed it. You keep Pro until <b className="text-foreground">{day(done.proUntil)}</b>. Billing resumes on{" "}
              <b className="text-foreground">{day(done.resumesOn)}</b> at <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}</b>. Your saved clips stay available.
            </p>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {step === "done_discount" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">40% off is applied</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Stripe confirmed it. Your next payment on <b className="text-foreground">{day(done.nextBillingDate)}</b> is{" "}
              <b className="text-foreground">{usd(DISCOUNTED_CENTS)}</b>. After that it returns to <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}/month</b>.
            </p>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {step === "done_cancel" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Your cancellation is confirmed</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Stripe confirmed it. You keep Pro until <b className="text-foreground">{day(done.accessUntil)}</b>. Changed your mind? You can undo this before then.
            </p>
            <button type="button" className={secondary} disabled={!!busy}
              onClick={() => void run<Done>("Undoing…", "undo-cancel", {}, () => { void loadState(); onClose(); })}>
              {busy ?? "Undo cancellation"}
            </button>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
