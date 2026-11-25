import { offerDeadlineMs } from "./offer-cookie.ts";

/** The Black Friday deal: the first month of Pro for $14 (half off), through the end of this day (US Pacific, like the offer link). */
export const BLACK_FRIDAY_UNTIL = "2026-12-03";
export const BLACK_FRIDAY_PRICE_DOLLARS = 14;
/** The one link every Black Friday button and email uses: straight to checkout with the $14 offer, and it stops working itself after the end date. */
export const BLACK_FRIDAY_LINK = `/claim?offer=14&until=${BLACK_FRIDAY_UNTIL}`;
export const BLACK_FRIDAY_ENDS_TEXT = "Ends Dec 3";

/** Is the deal still running? The same end of day the link itself uses. */
export function blackFridayActive(now: number = Date.now()): boolean {
  const deadline = offerDeadlineMs(BLACK_FRIDAY_UNTIL);
  return deadline !== null && now <= deadline;
}

/**
 * Who sees a Black Friday banner. `strip` (landing page): everyone, except a signed-in person who cannot use the deal.
 * `card` (dashboard): only a signed-in person who has never bought anything and is not Pro.
 */
export function showBlackFridayBanner(args: { variant: "strip" | "card"; active: boolean; signedIn: boolean; newCustomer: boolean }): boolean {
  if (!args.active) return false;
  if (args.variant === "card") return args.signedIn && args.newCustomer;
  return !args.signedIn || args.newCustomer;
}
