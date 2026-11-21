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
