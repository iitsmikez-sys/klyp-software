import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLACK_FRIDAY_UNTIL, BLACK_FRIDAY_LINK, BLACK_FRIDAY_PRICE_DOLLARS, blackFridayActive, showBlackFridayBanner } from "../lib/black-friday.ts";
import { offerCookieValueFor, offerPriceCents } from "../lib/offer-cookie.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const END = Date.parse("2026-12-03T23:59:59-08:00");

test("the deal runs through the end of Dec 3 (US Pacific) and then turns itself off", () => {
  assert.equal(BLACK_FRIDAY_UNTIL, "2026-12-03");
  assert.equal(blackFridayActive(Date.parse("2026-11-26T12:00:00Z")), true);
  assert.equal(blackFridayActive(END), true);
  assert.equal(blackFridayActive(END + 1), false);
});

test("every button uses one link: the $14 claim link with the same end date, so the link itself also stops working", () => {
  assert.equal(BLACK_FRIDAY_PRICE_DOLLARS, 14);
  assert.equal(BLACK_FRIDAY_LINK, "/claim?offer=14&until=2026-12-03");
  assert.equal(offerPriceCents(offerCookieValueFor(BLACK_FRIDAY_UNTIL, END - 1000, "14")), 1400);
  assert.equal(offerCookieValueFor(BLACK_FRIDAY_UNTIL, END + 1000, "14"), null);
});

test("the landing strip shows to visitors and to people who can use the deal; the dashboard card only to new signed-in accounts", () => {
  const base = { active: true, signedIn: false, newCustomer: false };
  assert.equal(showBlackFridayBanner({ ...base, variant: "strip" }), true, "a signed-out visitor");
  assert.equal(showBlackFridayBanner({ ...base, variant: "strip", signedIn: true, newCustomer: true }), true);
  assert.equal(showBlackFridayBanner({ ...base, variant: "strip", signedIn: true, newCustomer: false }), false, "signed in but cannot use it (Pro or bought before)");
  assert.equal(showBlackFridayBanner({ ...base, variant: "card" }), false, "the dashboard needs a signed-in account");
  assert.equal(showBlackFridayBanner({ ...base, variant: "card", signedIn: true, newCustomer: true }), true);
  assert.equal(showBlackFridayBanner({ ...base, variant: "card", signedIn: true, newCustomer: false }), false);
  for (const variant of ["strip", "card"]) assert.equal(showBlackFridayBanner({ variant, active: false, signedIn: true, newCustomer: true }), false, "after the end date");
});

test("the banners are on the landing page and the dashboard, the checkout answer says who can use the deal, and the pass pop-up waits", () => {
  assert.ok(read("components/landing/LandingPage.tsx").includes('<BlackFridayBanner variant="strip" />'));
  assert.ok(read("app/(dashboard)/dashboard/page.tsx").includes('<BlackFridayBanner variant="card" />'));
  const route = read("app/api/stripe/checkout/route.ts");
  assert.ok(route.includes("signed_in: !!viewer") && route.includes("new_customer: isNewCustomer(profile)"));
  const popup = read("components/PassPopup.tsx");
  assert.ok(popup.includes("if (blackFridayActive()) return;"), "one offer on screen at a time");
  const banner = read("components/BlackFridayBanner.tsx");
  assert.ok(banner.includes("href={BLACK_FRIDAY_LINK}") && banner.includes("setActive(blackFridayActive())"), "the link, and the end date is checked in the browser");
  assert.ok(banner.includes("$28 a month, cancel any time"), "the card states what comes after the first month");
});

test("the monthly Pro card shows only the $14 first month while the deal runs (no $3 pass), and is the normal card again afterwards", () => {
  const pricing = read("components/PricingSection.tsx");
  assert.ok(pricing.includes("setBlackFriday(blackFridayActive())"), "the end date is checked in the browser");
  assert.ok(pricing.includes('plan.id === "pro" && blackFriday && !yearly ? BLACK_FRIDAY_LINK : plan.cta.href'), "the button opens the $14 link, only on the monthly view");
  assert.ok(pricing.includes("`Get Pro for $${BLACK_FRIDAY_PRICE_DOLLARS}`"), "the $14 button");
  assert.ok(!pricing.includes("data-pass-link") && !pricing.includes("or try {trial.days}"), "no $3 pass link next to the $14 offer");
  assert.ok(pricing.includes("Then ${MONTHLY_PRICE_USD}/month unless you cancel"), "the $28 after the first month is stated");
  assert.ok(pricing.includes('plan.id === "pro" && trial && !yearly ? `Start for $${trial.priceCents / 100}`'), "outside the deal the card still says Start for $3");
});
