"use client";

import { useState } from "react";
import { useSparks } from "@/components/SparksProvider";
import { SparkIcon } from "@/components/SparksBalance";
import { SPARKS_ALLOWANCE } from "@/lib/tier";

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
  { ok: true, text: "60 Sparks per month" },
  { ok: true, text: "AI clip detection with viral scores" },
  { ok: true, text: "9:16 vertical exports, 1080×1920" },
  { ok: true, text: "AI captions — BOLD, CLEAN & KLYP styles" },
  { ok: false, text: "Moving klyp.world watermark on every clip" },
];

const PRO_FEATURES: string[] = [
  "500 Sparks per month — 8× more analyses",
  "No watermark. Clean clips, your brand only",
  "Raw exports — edit clips yourself in CapCut",
  "Streamer handle overlay on exports",
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
  const { tier, balance } = useSparks();
  const isPro = tier === "pro";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowance = SPARKS_ALLOWANCE[tier];
  const used = balance !== null ? Math.min(allowance, Math.max(0, allowance - balance)) : 0;
  const usedPct = allowance > 0 ? Math.round((used / allowance) * 100) : 0;

  const startCheckout = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
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

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `Request failed (HTTP ${res.status}).`);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal.");
      setBusy(false);
    }
  };

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
            <p className="text-xs text-amber-400 font-semibold mb-2">
              🔥 Limited early adopter pricing
            </p>
          )}
          <div className="flex items-end gap-1.5 mb-3">
            <span className="font-syne text-4xl font-bold text-accent">$29</span>
            <span className="text-sm text-foreground-muted mb-1.5">USD/mo</span>
          </div>

          {/* Savings badge */}
          <div className="mb-5 px-3 py-2 rounded-lg bg-accent-glow border border-accent/30">
            <p className="text-[11px] text-accent font-semibold leading-snug">
              💸 Most streamers make this back in 1 viral clip
            </p>
          </div>

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
            onClick={isPro ? openPortal : startCheckout}
            disabled={busy}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-60 ${
              !isPro && !busy ? "pulse-glow" : ""
            }`}
          >
            {busy && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
            )}
            {isPro ? "Manage billing" : "Upgrade to Pro"}
          </button>

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
