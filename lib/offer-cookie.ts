/**
 * The $17 first-month offer is for people who arrive from the ad link (`/?offer=17`). The site saves that
 * in a cookie for 30 days so it survives signing up and confirming an email. No imports on purpose: the
 * request proxy loads this file.
 */
export const OFFER_COOKIE = "klyp_offer";
export const OFFER_VALUE = "17";
export const OFFER_PARAM = "offer";
export const OFFER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
