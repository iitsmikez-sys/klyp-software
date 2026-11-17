"use client";

import { useSparks } from "./SparksProvider";

/**
 * True once we know the person is on Free, so the Raw button shows its lock. While the plan is still loading it is false,
 * so a Pro member never sees a lock flash (the server refuses a Free raw download either way).
 */
export function useRawLocked(): boolean {
  const { tier, balance } = useSparks();
  return balance !== null && tier !== "pro";
}
