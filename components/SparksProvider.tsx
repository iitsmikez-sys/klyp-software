"use client";

import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasProAccess, type Tier, type Profile } from "@/lib/tier";

type SparksContextValue = {
  /** null while loading (or if not signed in) */
  balance: number | null;
  tier: Tier;
  complimentaryPro: boolean;
  /** When the allowance next refills (profiles.sparks_reset_at), null while
   *  loading. A rolling 30 days from the last reset, not a calendar month. */
  resetAt: string | null;
  /** Overwrite the balance with a server-authoritative value (from /api/analyze). */
  sync: (balance: number) => void;
  /** Re-fetch the profile from Supabase. */
  refresh: () => Promise<void>;
};

const SparksContext = createContext<SparksContextValue>({
  balance: null,
  tier: "free",
  complimentaryPro: false,
  resetAt: null,
  sync: () => {},
  refresh: async () => {},
});

export function SparksProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>("free");
  const [complimentaryPro, setComplimentaryPro] = useState(false);
  const [resetAt, setResetAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // get_profile applies the lazy monthly Sparks reset server-side.
    const { data, error } = await supabase.rpc("get_profile");
    if (error || !data) return;
    const profile = data as Profile;
    setBalance(profile.sparks);
    setResetAt(profile.sparks_reset_at ?? null);
    // "Pro" requires a real, confirmed subscription behind it — not just the
    // raw tier flag. The flag alone can drift from reality (e.g. a manual
    // dashboard edit, a bug, a webhook mis-fire); every part of the app that
    // gates on tier goes through this one derivation, so fixing it here fixes
    // it everywhere at once.
    const granted = user.app_metadata?.klyp_complimentary_pro === true;
    setTier(hasProAccess({ ...profile, complimentary_pro: granted }) ? "pro" : "free");
    setComplimentaryPro(granted);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Returning from Stripe Checkout (success_url has ?upgraded=1): the webhook may not
  // have landed yet, so ask the server to read the subscription from Stripe now. It is
  // idempotent with the webhook (same invoice-keyed rules), so it can never grant twice.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") !== "1") return;
    fetch("/api/stripe/sync", { method: "POST" })
      .then(() => refresh())
      .catch(() => {
        // Best effort: the webhook (and the daily reconcile) still apply the upgrade.
      });
  }, [refresh]);

  const sync =useCallback((next: number) => setBalance(next), []);

  return (
    <SparksContext.Provider value={{ balance, tier, complimentaryPro, resetAt, sync, refresh }}>
      {children}
    </SparksContext.Provider>
  );
}

export function useSparks() {
  return useContext(SparksContext);
}
