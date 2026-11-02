"use client";

import { useCallback, useEffect, useState } from "react";
import { SPARKS_ALLOWANCE } from "@/lib/tier";
import { addMonthsUtc, DISCOUNT_SAVING_CENTS, DISCOUNTED_CENTS, RETENTION, type Reason, type SubReason } from "@/lib/retention-core";

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
/** When billing restarts after pausing `m` months from the end of the paid period (same math as the server). */
const resumeIso = (periodEndIso: string, m: number) =>
  new Date(addMonthsUtc(Math.floor(new Date(periodEndIso).getTime() / 1000), m) * 1000).toISOString();
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const usd = (cents: number) => (cents % 100 === 0 ? `${cents / 100}` : `${(cents / 100).toFixed(2)}`);
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

  const pauseDates = state?.periodEnd ? { proUntil: state.periodEnd, resumes: resumeIso(state.periodEnd, months) } : null;

  const renderOffer = () => {
    if (!reason) return null;
    const pauseCard = (
      <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
        <p className="text-sm font-semibold text-foreground">Pause instead of cancelling</p>
        <div className="grid grid-cols-2 gap-2">
          {([1, 2] as const).map((m) => (
            <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)} className={`${choice(months === m)} flex-col gap-0.5 !items-center text-center`}>
              <span className="font-semibold text-foreground">{m} month{m > 1 ? "s" : ""}</span>
              {state?.periodEnd && <span className="text-xs">back {shortDay(resumeIso(state.periodEnd, m))}</span>}
            </button>
          ))}
        </div>
        {pauseDates && (
          <ol className="space-y-0 text-sm">
            {[
              { dot: "bg-accent", title: `Now to ${shortDay(pauseDates.proUntil)}`, note: "You keep Pro" },
              { dot: "bg-foreground-muted", title: `${shortDay(pauseDates.proUntil)} to ${shortDay(pauseDates.resumes)}`, note: "Paused. $0 charged. Your account and clips stay." },
              { dot: "bg-accent", title: shortDay(pauseDates.resumes), note: `Pro returns at ${usd(RETENTION.PRICE_CENTS)} with ${SPARKS_ALLOWANCE.pro} new Sparks` },
            ].map((row, i, all) => (
              <li key={row.title} className="flex gap-3">
                <span className="flex flex-col items-center">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${row.dot}`} />
                  {i < all.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
                </span>
                <span className="pb-3">
                  <span className="block font-semibold text-foreground">{row.title}</span>
                  <span className="block text-xs text-foreground-muted">{row.note}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-foreground-muted">We&apos;ll email you before it restarts.</p>
        <button type="button" className={primary} disabled={!!busy || !state || state.paused || state.cancelAtPeriodEnd}
          onClick={() => void run<Done>("Confirming…", "pause", { eventId, months }, (d) => { setDone(d); setStep("done_pause"); void loadState(); })}>
          {busy ? busy : "Pause my subscription"}
        </button>
        {state?.paused && <p className="text-xs text-foreground-muted">Your subscription is already paused.</p>}
        {state?.cancelAtPeriodEnd && <p className="text-xs text-foreground-muted">Your cancellation is already scheduled. Undo it first to pause.</p>}
      </div>
    );
    const discountCard = state?.discountEligible ? (
      <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{RETENTION.DISCOUNT_PERCENT}% off</p>
          <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-background">Save {usd(DISCOUNT_SAVING_CENTS)}</span>
        </div>
        <p className="flex items-baseline gap-2.5">
          <span className="text-3xl font-semibold leading-none text-foreground">{usd(DISCOUNTED_CENTS)}</span>
          <span className="text-base text-foreground-muted line-through">{usd(RETENTION.PRICE_CENTS)}</span>
        </p>
        <p className="text-xs text-foreground-muted">
          One payment on {day(state.periodEnd)}. Then back to <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}/month</b>.
        </p>
        <button type="button" className={primary} disabled={!!busy}
          onClick={() => void run<Done>("Confirming…", "discount", { eventId }, (d) => { setDone(d); setStep("done_discount"); void loadState(); })}>
          {busy ? busy : `Pay ${usd(DISCOUNTED_CENTS)} this month`}
        </button>
      </div>
    ) : null;
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
        {reason === "too_expensive" && (discountCard ?? (
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">
            {state?.discountAvailableOn
              ? <>You've used this offer recently. It's available again on <b className="text-foreground">{day(state.discountAvailableOn)}</b>.</>
              : <>The discount can't be applied to this subscription right now.</>}
          </div>
        ))}
        {reason === "other" && (
          <p className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-foreground-muted">Thanks for telling us. Your feedback was saved.</p>
        )}
        {reason !== "too_expensive" && discountCard && (
          <>
            <p className="pt-1 text-center text-xs text-foreground-muted">Or, if you&apos;d like to stay</p>
            {discountCard}
          </>
        )}
        <button type="button" className={secondary} disabled={!!busy} onClick={onClose}>{reason === "break" || reason === "not_using" ? "Never mind" : "Keep my subscription"}</button>
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
          </>
        )}
        {step === "offer" && renderOffer()}
        {step === "confirm_cancel" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Cancel your subscription?</h2>
            <p className="text-sm text-foreground">
              You&apos;ll keep Pro until <b>{day(state?.periodEnd)}</b>.
            </p>
            <ul className="space-y-1.5 text-xs text-foreground-muted">
              {["Pro features and your Sparks until then", "Your saved clips and account always stay", "You won't be charged again"].map((line) => (
                <li key={line} className="flex gap-2"><span aria-hidden="true" className="text-accent">&#10003;</span><span>{line}</span></li>
              ))}
            </ul>
            <button type="button" className={primary} disabled={!!busy}
              onClick={() => void run<Done>("Confirming…", "cancel", { eventId }, (d) => { setDone(d); setStep("done_cancel"); void loadState(); })}>
              {busy ?? "Confirm cancellation"}
            </button>
            <button type="button" className={secondary} disabled={!!busy} onClick={onClose}>Keep Pro</button>
            {(reason === "break" || reason === "not_using") && (
              <button type="button" className={quiet} disabled={!!busy} onClick={() => { setError(null); setStep("offer"); }}>Pause instead</button>
            )}
          </>
        )}
        {step === "done_pause" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Your subscription is paused</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              You keep Pro until <b className="text-foreground">{day(done.proUntil)}</b>. Billing resumes on{" "}
              <b className="text-foreground">{day(done.resumesOn)}</b> at <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}</b>. Your saved clips stay available.
            </p>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {step === "done_discount" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">{RETENTION.DISCOUNT_PERCENT}% off is applied</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Your next payment on <b className="text-foreground">{day(done.nextBillingDate)}</b> is{" "}
              <b className="text-foreground">{usd(DISCOUNTED_CENTS)}</b>. After that it returns to <b className="text-foreground">{usd(RETENTION.PRICE_CENTS)}/month</b>.
            </p>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {step === "done_cancel" && (
          <>
            <h2 className="font-syne text-lg font-bold text-foreground">Done. Your subscription ends {day(done.accessUntil)}.</h2>
            <p className="text-sm leading-relaxed text-foreground-muted">
              You keep Pro until then. Download any clips you want a local copy of.
            </p>
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-foreground-muted">Changed your mind?</p>
              <button type="button" className={secondary} disabled={!!busy}
                onClick={() => void run<Done>("Undoing…", "undo-cancel", {}, () => { void loadState(); onClose(); })}>
                {busy ?? "Undo cancellation"}
              </button>
            </div>
            <button type="button" className={primary} onClick={onClose}>Done</button>
          </>
        )}
        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
