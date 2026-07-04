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
    setTier(profile.tier);
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
