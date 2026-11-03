/** Public Pro prices, in whole dollars, for the pricing pages. Checkout charges the cents values in lib/stripe.ts; a test keeps the two in step. */
export const MONTHLY_PRICE_USD = 28;
export const YEARLY_PRICE_USD = 276;
/** What the yearly price comes to per month: $23. */
export const YEARLY_PER_MONTH_USD = YEARLY_PRICE_USD / 12;
/** 12 monthly payments vs one yearly payment, rounded: 18. */
export const YEARLY_SAVE_PERCENT = Math.round((1 - YEARLY_PRICE_USD / (MONTHLY_PRICE_USD * 12)) * 100);
