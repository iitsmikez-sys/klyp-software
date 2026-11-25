import type { RawOffer } from "./raw-pro.ts";

/** A person who closes the pop-up is not shown it again for this long. */
export const POPUP_QUIET_MS = 24 * 60 * 60 * 1000;
/** How long after the dashboard opens before the pop-up may show. */
export const POPUP_DELAY_MS = 8000;

/** Pure: may the pass pop-up show now? Free accounts only, only with a cheap offer to make, and not again within a day of closing it. */
export function shouldShowPassPopup(args: { loaded: boolean; isFree: boolean; offer: RawOffer; closedAt: number | null; now: number }): boolean {
  if (!args.loaded || !args.isFree || args.offer.kind === "none") return false;
  return args.closedAt === null || args.now - args.closedAt >= POPUP_QUIET_MS;
}

/** The one-tap question shown after "Not now": why they did not take the pass. The ids are what gets counted; keep them stable. */
export const PASS_REASONS = [
  { id: "too_expensive", label: "It costs too much" },
  { id: "not_sure_it_works", label: "Not sure it works for me" },
  { id: "missing_something", label: "Something I need is missing" },
  { id: "just_looking", label: "Just looking around" },
] as const;
export type PassReason = (typeof PASS_REASONS)[number]["id"];
