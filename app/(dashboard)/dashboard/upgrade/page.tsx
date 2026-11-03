"use client";

import { useEffect, useState } from "react";
import { useSparks } from "@/components/SparksProvider";
import { SparkIcon } from "@/components/SparksBalance";
import { SPARKS_ALLOWANCE } from "@/lib/tier";
import { vodsPhrase } from "@/lib/sparks";
import CancelFlow from "@/components/CancelFlow";
import { DEFAULT_PACK_ID, SPARK_PACKS, packById } from "@/lib/spark-packs";
import { MONTHLY_PRICE_USD, YEARLY_PER_MONTH_USD, YEARLY_PRICE_USD, YEARLY_SAVE_PERCENT } from "@/lib/pricing";

function Check() {
  return (
    <svg className="flex-shrink-0 mt-0.5" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Warn() {
  return (
    <svg className="flex-shrink-0 mt-0.5" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5a5a72" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.5" fill="#5a5a72" />
    </svg>
  );
}

const FREE_FEATURES: { ok: boolean; text: string }[] = [
  { ok: true, text: `${SPARKS_ALLOWANCE.free} Sparks every 30 days — ${vodsPhrase(SPARKS_ALLOWANCE.free)}` },
  { ok: true, text: "AI clip detection with viral scores" },
  { ok: true, text: "9:16 vertical and Original (no crop) exports" },
  { ok: true, text: "AI captions — BOLD, CLEAN & KLYP styles" },
  { ok: true, text: "YouTube and Twitch videos up to 2 hours" },
  { ok: false, text: "No direct video uploads or automatic clipping (Pro)" },
  { ok: false, text: "Animated Klyp watermark on free exports" },
];

const PRO_FEATURES: string[] = [
  `${SPARKS_ALLOWANCE.pro} Sparks every 30 days — ${vodsPhrase(SPARKS_ALLOWANCE.pro)}`,
  "No watermark. Clean clips, your brand only",
  "All export formats: 9:16, Original, 1:1 and 16:9",
  "Raw exports — edit clips yourself in CapCut",
  "Streamer handle overlay on exports",
  "Longer VODs from Twitch and YouTube, plus direct video uploads",
  "Automatic clipping when your Twitch stream ends",
  "Twitch chat spike detection",
  "Download all clips as ZIP",
  "Priority support",
];

/** Hover style shared by every feature row. */
const FEATURE_ROW =
  "flex items-start gap-2.5 rounded-lg -mx-2 px-2 py-1 transition-colors hover:bg-surface-2";

/** Fake avatar stack for social proof — pure CSS, no images. */
function AvatarStack() {
  const colors = ["#8b5cf6", "#00E5A0", "#f59e0b", "#38bdf8"];
  return (
    <span className="inline-flex items-center mr-2 align-middle">
      {colors.map((c, i) => (
        <span
          key={c}
          className="w-5 h-5 rounded-full border-2 border-surface inline-block"
          style={{ backgroundColor: c, marginLeft: i === 0 ? 0 : -7, opacity: 0.9 }}
        />
      ))}
    </span>
  );
}

export default function UpgradePage() {
  const { tier, balance, complimentaryPro } = useSparks();
  const isPro = tier === "pro";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingSetupNeeded, setBillingSetupNeeded] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [yearly, setYearly] = useState(true);
  const [packId, setPackId] = useState<string>(DEFAULT_PACK_ID);
  const [packBusy, setPackBusy] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  // Monthly Pro members can switch to the yearly plan: null = not offered (or still checking).
  const [yearlyOffer, setYearlyOffer] = useState<"offer" | "confirm" | "working" | "done" | null>(null);
  const [yearlyNote, setYearlyNote] = useState<string | null>(null);
  useEffect(() => {
    if (tier !== "pro" || complimentaryPro) return;
    let active = true;
    fetch("/api/stripe/switch-yearly").then((r) => r.json()).then((d) => { if (active && d?.eligible) setYearlyOffer("offer"); }).catch(() => {});
    return () => { active = false; };
  }, [tier, complimentaryPro]);
  useEffect(() => { const t = setTimeout(() => setWaitedTooLong(true), 4000); return () => clearTimeout(t); }, []);
  // New people can pay $17 for the first month; the server decides who qualifies. Open on the monthly view so they see it.
  const [firstMonthCents, setFirstMonthCents] = useState<number | null>(null);
  useEffect(() => {
    if (isPro) return;
    let cancelled = false;
    fetch("/api/stripe/checkout").then((r) => r.json()).then((d) => {
      if (cancelled || typeof d?.first_month?.price_cents !== "number") return;
      setFirstMonthCents(d.first_month.price_cents);
      setYearly(false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isPro]);

  const allowance = SPARKS_ALLOWANCE[tier];
  const used = balance !== null ? Math.min(allowance, Math.max(0, allowance - balance)) : 0;
  const usedPct = allowance > 0 ? Math.round((used / allowance) * 100) : 0;

  const startCheckout = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: yearly ? "year" : "month" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Checkout failed (HTTP ${res.status}).`);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBusy(false);
    }
  };

  const switchToYearly = async () => {
    setYearlyOffer("working");
    setYearlyNote(null);
    try {
      const res = await fetch("/api/stripe/switch-yearly", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Could not switch plans (HTTP ${res.status}).`);
      setYearlyOffer("done");
    } catch (err) {
      setYearlyNote(err instanceof Error ? err.message : "Could not switch plans.");
      setYearlyOffer("confirm");
    }
  };

  const buyPack = async () => {
    if (packBusy) return;
    setPackBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? `Checkout failed (HTTP ${res.status}).`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setPackBusy(false);
    }
  };

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.code === "billing_account_missing") {
        setBillingSetupNeeded(true);
        setError(data.error);
        setBusy(false);
        return;
      }
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal.");
      setBusy(false);
    }
  };

  // Until the plan has loaded, show nothing: the page would otherwise flash the Free view to a Pro member.
  if (balance === null && !waitedTooLong) return <div className="min-h-[60vh]" aria-busy="true" />;

  return (
    <div className="relative p-8 max-w-4xl mx-auto animate-fade-in pricing-grid-bg">
      <header className="relative mb-10 text-center">
        <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-2">
          Pricing
        </p>
        <h1 className="font-syne text-3xl md:text-4xl font-bold text-foreground">
          Go Pro. Lose the watermark.
        </h1>
        <p className="text-foreground-muted mt-2 text-sm max-w-md mx-auto">
          More Sparks, clean exports, and every tool Klyp has — one flat price.
        </p>
      </header>

      {error && (
        <div className="relative mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 text-center">
          {error}
        </div>
      )}

      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
        {/* Free */}
        <div className="lift flex flex-col rounded-2xl border border-border bg-surface p-7 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)]">
          <p className="font-syne text-xs font-bold uppercase tracking-[0.15em] text-foreground-muted mb-1">
            Free
          </p>
          <p className="text-xs text-foreground-muted mb-2">Perfect for trying Klyp</p>
          <div className="flex items-end gap-1.5 mb-5">
            <span className="font-syne text-4xl font-bold text-foreground">$0</span>
            <span className="text-sm text-foreground-muted mb-1.5">forever</span>
          </div>
          <div className="h-px bg-border mb-5" />
          <ul className="flex flex-col gap-2 flex-1 mb-7">
            {FREE_FEATURES.map((f) => (
              <li key={f.text} className={FEATURE_ROW}>
                {f.ok ? <Check /> : <Warn />}
                <span className={`text-sm leading-snug ${f.ok ? "text-foreground-muted" : "text-subtle"}`}>
                  {f.text}
                </span>
              </li>
            ))}
          </ul>

          <div
            className={`w-full text-center py-2.5 rounded-xl text-sm font-bold font-syne border ${
              !isPro
                ? "border-accent/40 text-accent bg-accent-glow"
                : "border-border text-foreground-muted"
            }`}
          >
            {!isPro ? "Your current plan" : "Included with Pro"}
          </div>
        </div>

        {/* Pro */}
        <div className="lift relative flex flex-col rounded-2xl border border-accent/50 bg-surface p-7 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7),0_0_24px_rgba(0,229,160,0.15)]">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-background text-[11px] font-bold font-syne tracking-wide whitespace-nowrap">
              <SparkIcon size={11} />
              {isPro ? "Your plan" : "Most popular"}
            </span>
          </div>

          <p className="font-syne text-xs font-bold uppercase tracking-[0.15em] text-accent mb-1">
            Pro
          </p>
          {!isPro && (
            <div className="mb-3 flex items-center gap-3 text-xs">
              <span className={yearly ? "text-foreground-muted" : "font-semibold text-foreground"}>Monthly</span>
              <button
                type="button"
                role="switch"
                aria-checked={yearly}
                aria-label="Bill yearly"
                onClick={() => setYearly((v) => !v)}
                className={`relative h-5 w-9 rounded-full border transition-colors ${yearly ? "border-accent/50 bg-accent-glow" : "border-border bg-surface-2"}`}
              >
                <span className={`absolute top-0.5 block h-3.5 w-3.5 rounded-full transition-all ${yearly ? "left-4 bg-accent" : "left-0.5 bg-foreground-muted"}`} />
              </button>
              <span className={yearly ? "font-semibold text-foreground" : "text-foreground-muted"}>Yearly</span>
              <span className="font-semibold text-accent">Save {YEARLY_SAVE_PERCENT}%</span>
            </div>
          )}
          {!isPro && yearly ? (
            <div className="mb-3">
              <div className="flex items-end gap-2">
                <span className="font-syne text-4xl font-bold text-accent">${YEARLY_PER_MONTH_USD}</span>
                <span className="mb-1.5 text-base text-foreground-muted line-through">${MONTHLY_PRICE_USD}</span>
                <span className="mb-1.5 text-sm text-foreground-muted">USD/mo</span>
              </div>
              <p className="text-xs text-foreground-muted">Billed ${YEARLY_PRICE_USD} a year</p>
            </div>
          ) : !isPro && firstMonthCents !== null ? (
            <div className="mb-3">
              <div className="flex items-end gap-2">
                <span className="mb-1.5 text-xl text-foreground-muted line-through">${MONTHLY_PRICE_USD}</span>
                <span className="font-syne text-4xl font-bold text-accent">${firstMonthCents / 100}</span>
                <span className="mb-1.5 text-sm text-foreground-muted">USD first month</span>
              </div>
              <p className="text-xs text-foreground-muted">Then ${MONTHLY_PRICE_USD}/mo. Cancel anytime.</p>
            </div>
          ) : (
            <div className="flex items-end gap-1.5 mb-3">
              <span className="font-syne text-4xl font-bold text-accent">${MONTHLY_PRICE_USD}</span>
              <span className="text-sm text-foreground-muted mb-1.5">USD/mo</span>
            </div>
          )}

          <div className="h-px bg-border mb-5" />
          <ul className="flex flex-col gap-2 flex-1 mb-7">
            {PRO_FEATURES.map((text) => (
              <li key={text} className={FEATURE_ROW}>
                <Check />
                <span className="text-sm leading-snug text-foreground-muted">{text}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={complimentaryPro ? undefined : isPro && !billingSetupNeeded ? openPortal : startCheckout}
            disabled={busy || complimentaryPro}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-60 ${
              !isPro && !busy ? "pulse-glow" : ""
            }`}
          >
            {busy && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
            )}
            {complimentaryPro ? "Complimentary Pro active" : billingSetupNeeded ? "Set up billing" : isPro ? "Manage billing" : !yearly && firstMonthCents !== null ? `Get Pro for $${firstMonthCents / 100}` : "Upgrade to Pro"}
          </button>

          {yearlyOffer && (
            <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3 text-center">
              {yearlyOffer === "done" ? (
                <p role="status" className="text-xs text-foreground">You're on the yearly plan now. Thanks!</p>
              ) : (
                <>
                  <p className="text-xs font-semibold text-foreground">Switch to yearly: $276/yr, save 18%</p>
                  {yearlyOffer === "offer" ? (
                    <button type="button" onClick={() => setYearlyOffer("confirm")}
                      className="mt-1.5 text-xs font-semibold text-accent hover:underline">See how it works</button>
                  ) : (
                    <>
                      <p className="mt-1 text-[11px] leading-snug text-foreground-muted">
                        You're charged $276 today, minus credit for the unused part of this month. Your Sparks stay as they are and you keep getting 500 every month.
                      </p>
                      {yearlyNote && <p role="alert" className="mt-1 text-[11px] text-red-400">{yearlyNote}</p>}
                      <div className="mt-2 flex justify-center gap-3">
                        <button type="button" onClick={() => void switchToYearly()} disabled={yearlyOffer === "working"}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-dim disabled:opacity-60">
                          {yearlyOffer === "working" ? "Switching…" : "Switch to yearly"}
                        </button>
                        <button type="button" onClick={() => { setYearlyOffer("offer"); setYearlyNote(null); }} disabled={yearlyOffer === "working"}
                          className="text-xs text-foreground-muted hover:text-foreground">Not now</button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {isPro && !complimentaryPro && !billingSetupNeeded && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="mt-2 w-full py-1 text-center text-[11px] text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Cancel subscription
            </button>
          )}

          {/* Social proof */}
          <p className="text-center text-[11px] text-foreground-muted mt-3">
            <AvatarStack />
            Join <span className="text-foreground font-semibold">300+ streamers</span> clipping with Klyp
          </p>
          {!isPro && (
            <p className="text-center text-[11px] text-subtle mt-1">
              Cancel anytime from this page.
            </p>
          )}
        </div>
      </div>

      {/* Spark packs: one-time top-ups for any plan */}
      <section id="packs" className="relative mx-auto mt-8 max-w-4xl rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-syne text-base font-bold text-foreground">Need more Sparks?</h2>
        <p className="mt-0.5 text-xs text-foreground-muted">Add a pack to any plan. Bought Sparks never expire.</p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Spark pack">
          {SPARK_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              role="radio"
              aria-checked={packId === pack.id}
              onClick={() => setPackId(pack.id)}
              className={`rounded-xl border px-2 py-3 text-center transition-colors ${
                packId === pack.id ? "border-accent/60 bg-accent/10" : "border-border bg-surface-2 hover:border-subtle"}`}
            >
              <span className="block text-xs text-foreground-muted">{pack.sparks} Sparks</span>
              <span className="mt-0.5 block font-syne text-xl font-bold text-foreground">${pack.cents / 100}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void buyPack()}
          disabled={packBusy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-bold font-syne text-background transition-colors hover:bg-accent-dim disabled:opacity-60"
        >
          {packBusy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-transparent" />}
          Buy {packById(packId)?.sparks} Sparks for ${(packById(packId)?.cents ?? 0) / 100}
        </button>
      </section>

      {cancelOpen && <CancelFlow onClose={() => setCancelOpen(false)} />}

      {/* Sparks meter — used vs total this cycle */}
      {balance !== null && (
        <div className="relative max-w-sm mx-auto mt-10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold font-syne uppercase tracking-wider text-foreground-muted">
              Sparks this cycle
            </span>
            <span className="text-xs text-foreground-muted">
              <span className="font-syne font-bold text-accent">{used}</span> / {allowance} ⚡ used
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-2 border border-border overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          {!isPro && (
            <p className="text-center text-[11px] text-foreground-muted mt-2">
              Pro refills you to {SPARKS_ALLOWANCE.pro} ⚡ instantly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
