"use client";

import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tier, Profile } from "@/lib/tier";

type SparksContextValue = {
  /** null while loading (or if not signed in) */
  balance: number | null;
  tier: Tier;
  /** Overwrite the balance with a server-authoritative value (from /api/analyze). */
  sync: (balance: number) => void;
  /** Re-fetch the profile from Supabase. */
  refresh: () => Promise<void>;
};

const SparksContext = createContext<SparksContextValue>({
  balance: null,
  tier: "free",
  sync: () => {},
  refresh: async () => {},
});

export function SparksProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>("free");

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // get_profile applies the lazy monthly Sparks reset server-side.
    const { data, error } = await supabase.rpc("get_profile");
    if (error || !data) return;
    const profile = data as Profile;
    setBalance(profile.sparks);
    // "Pro" requires a real, confirmed subscription behind it — not just the
    // raw tier flag. The flag alone can drift from reality (e.g. a manual
    // dashboard edit, a bug, a webhook mis-fire); every part of the app that
    // gates on tier goes through this one derivation, so fixing it here fixes
    // it everywhere at once.
    setTier(profile.tier === "pro" && profile.stripe_subscription_id ? "pro" : "free");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sync = useCallback((next: number) => setBalance(next), []);

  return (
    <SparksContext.Provider value={{ balance, tier, sync, refresh }}>
      {children}
    </SparksContext.Provider>
  );
}

export function useSparks() {
  return useContext(SparksContext);
}
