"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PACK_ID, SPARK_PACKS, packById, packSavingsPercent } from "@/lib/spark-packs";
import { SparkIcon } from "./SparksBalance";

const TAGS: Record<string, string> = { p250: "Most popular", p500: "Best value" };

/** Shown when someone with no Sparks tries to analyze a video: buy a one-time pack, or look at Pro. */
export default function OutOfSparksDialog({ isPro, onClose }: { isPro: boolean; onClose: () => void }) {
  const [packId, setPackId] = useState<string>(DEFAULT_PACK_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = packById(packId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buy = async () => {
    if (busy) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="out-of-sparks-title" data-out-of-sparks-dialog>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-3 flex justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15"><SparkIcon size={22} className="text-accent" /></span>
        </div>
        <h3 id="out-of-sparks-title" className="text-center font-syne text-xl font-bold text-foreground">You&apos;re out of Sparks</h3>
        <p className="mb-5 mt-1.5 text-center text-sm text-foreground-muted">Top up once and keep clipping. No subscription needed.</p>

        <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Spark pack">
          {SPARK_PACKS.map((p) => {
            const on = p.id === packId;
            const save = packSavingsPercent(p);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPackId(p.id)}
                className={`relative rounded-xl border px-2 pb-3 pt-4 text-center transition-colors ${on ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-subtle"}`}>
                {TAGS[p.id] && (
                  <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-accent text-background" : "bg-border text-foreground-muted"}`}>{TAGS[p.id]}</span>
                )}
                <span className="block font-syne text-2xl font-bold text-foreground">{p.sparks}</span>
                <span className="mb-2 block text-xs text-foreground-muted">Sparks</span>
                <span className="block font-syne text-base font-bold text-foreground">${p.cents / 100}</span>
                {save > 0 && <span className="mt-1 block text-[11px] text-accent">Save {save}%</span>}
              </button>
            );
          })}
        </div>

        <button type="button" onClick={() => void buy()} disabled={busy}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold text-background transition-colors hover:bg-accent-dim disabled:opacity-60">
          {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-transparent" />}
          Buy {pack?.sparks} Sparks · ${(pack?.cents ?? 0) / 100}
        </button>
        {error && <p role="alert" className="mt-2 text-center text-xs text-red-400">{error}</p>}
        <p className="mt-2.5 text-center text-xs text-foreground-muted">Secure checkout with Stripe · Bought Sparks never expire</p>

        {!isPro && (
          <>
            <div className="my-4 flex items-center gap-2.5"><span className="h-px flex-1 bg-border" /><span className="text-xs text-foreground-muted">or</span><span className="h-px flex-1 bg-border" /></div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Klyp Pro</p>
                <p className="text-xs text-foreground-muted">500 Sparks every month, no watermark</p>
              </div>
              <a href="/dashboard/upgrade" className="whitespace-nowrap rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-subtle">See Pro</a>
            </div>
          </>
        )}
        <button type="button" onClick={onClose} className="mt-4 w-full text-center text-xs text-foreground-muted underline underline-offset-2 hover:text-foreground">Maybe later</button>
      </div>
    </div>
  );
}
