import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRIAL_DAYS, TRIAL_PRICE_CENTS, TRIAL_SPARKS, cardTrialKey, emailTrialKey, normalizeEmail, proTrialOffered, trialMode } from "../lib/pro-trial.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NEW = { tier: "free", stripe_customer_id: null, stripe_subscription_id: null };

test("the pass is 4 days for $3 with 250 Sparks, and is off unless PRO_TRIAL is on", () => {
  assert.equal(TRIAL_DAYS, 4);
  assert.equal(TRIAL_SPARKS, 250);
  assert.equal(TRIAL_PRICE_CENTS, 300);
  assert.equal(trialMode({}), "off");
  assert.equal(trialMode({ PRO_TRIAL: "" }), "off");
  assert.equal(trialMode({ PRO_TRIAL: "yes" }), "off");
  assert.equal(trialMode({ PRO_TRIAL: "ads" }), "off", "the old ads-only setting no longer exists");
  assert.equal(trialMode({ PRO_TRIAL: " ON " }), "on");
});

test("who is offered the pass: nobody when off; every new person when on, except ad-link visitors (they get the $17 first month); never someone who subscribed before", () => {
  assert.equal(proTrialOffered(NEW, "off", false), false);
  assert.equal(proTrialOffered(NEW, "on", false), true);
  assert.equal(proTrialOffered(NEW, "on", true), false, "an ad-link visitor is offered $17, not the pass");
  assert.equal(proTrialOffered(null, "on", false), false);
  assert.equal(proTrialOffered({ ...NEW, tier: "pro" }, "on", false), false);
  assert.equal(proTrialOffered({ ...NEW, stripe_customer_id: "cus_1" }, "on", false), false, "came back after a subscription: no second pass");
  assert.equal(proTrialOffered({ ...NEW, stripe_subscription_id: "sub_1" }, "on", false), false);
  assert.equal(proTrialOffered({ ...NEW, complimentary_pro: true }, "on", false), false);
});

test("one real person is one email: Gmail dots and +tags, googlemail, and +tags elsewhere do not make a new address", () => {
  assert.equal(normalizeEmail("A.B.C+promo@Gmail.com"), "abc@gmail.com");
  assert.equal(normalizeEmail("ab.c@googlemail.com"), "abc@gmail.com");
  assert.equal(normalizeEmail("Some.One+x@outlook.com"), "some.one@outlook.com", "dots matter outside Gmail");
  assert.equal(normalizeEmail("  Plain@Example.com "), "plain@example.com");
  assert.equal(normalizeEmail("nonsense"), "nonsense");
  assert.equal(normalizeEmail(null), "");
  assert.equal(emailTrialKey("a.b+c@gmail.com"), "email:ab@gmail.com");
  assert.equal(cardTrialKey("fp_123"), "card:fp_123");
});

test("checkout charges the $3 now, then starts a card-required 4-day trial of the monthly price, for new monthly people only, never stacked with the $17 offer or a promo code", () => {
  const route = read("app/api/stripe/checkout/route.ts");
  assert.ok(route.includes('const trial = newMonthly && await trialOffered(req, profile, user.id, user.email);'));
  assert.ok(route.includes('...(trial ? { payment_method_collection: "always" as const } : {}),'));
  assert.ok(route.includes("...(trial ? { trial_period_days: TRIAL_DAYS } : {}),"));
  assert.ok(route.includes('...(trial ? { trial: "1" } : {})'));
  assert.ok(route.includes("unit_amount: TRIAL_PRICE_CENTS,"), "the one-time $3 line");
  assert.ok(route.includes("...(trial ? [{"));
  assert.ok(route.includes("const firstMonth = newMonthly && !trial && firstMonthOfferAvailable("));
  assert.ok(route.includes("const promoField = newMonthly && !firstMonth && !trial;"));
  assert.match(route, /try \{ return !\(await trialKeysUsedByOthers\(userId, \[emailTrialKey\(email\)\]\)\); \} catch \{ return false; \}/, "fails closed");
  assert.ok(route.includes("trial: trial ? { days: TRIAL_DAYS, sparks: TRIAL_SPARKS, price_cents: TRIAL_PRICE_CENTS } : null,"));
});

test("the webhook recognises the $3 first invoice, gives 250 Sparks for it and 500 with the first real payment, and cancels a repeat pass before it gives anything", () => {
  const hook = read("app/api/stripe/webhook/route.ts");
  assert.ok(hook.includes('current.status === "trialing" && invoice.amount_paid === TRIAL_PRICE_CENTS && invoice.billing_reason === "subscription_create"'));
  assert.ok(hook.includes('subDetails?.metadata?.trial === "1"'));
  assert.ok(hook.includes("trialStart ? TRIAL_SPARKS : undefined"));
  assert.ok(hook.includes("p_balance: balance ?? SPARKS_ALLOWANCE[tier],"), "no balance override means the full allowance");
  assert.ok(hook.includes('(await claimTrialKeys(trialUserId, keys)) === "used"'));
  assert.ok(hook.includes("await getStripe().subscriptions.cancel(subscriptionId);"));
  assert.ok(hook.includes("await refundRefusedPass(invoice.id);"), "the $3 of a refused repeat is given back");
  assert.ok(hook.includes("stripe.invoicePayments.list({ invoice: invoiceId, limit: 5 })"));
  assert.ok(hook.includes("[stripe] REFUND NEEDED BY HAND"), "a failed refund is logged loudly and never breaks the event");
  assert.ok(hook.indexOf("claimTrialKeys(trialUserId, keys)") < hook.indexOf("trialStart ? TRIAL_SPARKS : undefined"), "the repeat check comes before the grant");
  assert.ok(hook.includes("cardTrialKey(fingerprint)"));
});

test("the used-passes table keeps both keys and only the server can read it", () => {
  const sql = read("supabase/migrations/051_trial_uses.sql");
  assert.match(sql, /create table if not exists public\.trial_uses/);
  assert.match(sql, /key\s+text primary key/);
  assert.match(sql, /alter table public\.trial_uses enable row level security;/);
  assert.doesNotMatch(sql, /create policy/i);
  const uses = read("lib/trial-uses.ts");
  assert.ok(uses.includes('error.code !== "23505"'), "a key that already exists is not an error");
  assert.ok(uses.includes("row.user_id !== userId"), "only a DIFFERENT account counts as a repeat");
});

test("the pages show the pass only when the server offers it, and name the price, the card, the days, the $28 after, and that the $3 is not refunded", () => {
  const upgrade = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(upgrade.includes("`Start for $${trial.priceCents / 100}`"));
  assert.ok(upgrade.includes("Card required."));
  assert.ok(upgrade.includes("{trial.days} days of full Pro, then ${MONTHLY_PRICE_USD}/month unless you cancel."));
  assert.ok(upgrade.includes("isn't refunded."));
  const pricing = read("components/PricingSection.tsx");
  assert.ok(pricing.includes("`Start for $${trial.priceCents / 100}`"));
  assert.ok(pricing.includes("{trial.days} days of full Pro, then ${MONTHLY_PRICE_USD}/month unless you cancel."));
  assert.ok(pricing.includes("Card required. The ${trial.priceCents / 100} isn't refunded."), "the small print is always shown");
  assert.ok(pricing.includes("isn't refunded."));
  assert.ok(read("app/page.tsx").includes('trial={trialMode() === "on" ? { days: TRIAL_DAYS, priceCents: TRIAL_PRICE_CENTS } : undefined}'), "the public page shows it only when it is on");
  assert.doesNotMatch(upgrade + pricing, /free trial/i, "nothing calls it free any more");
});

test("checkout says plainly what is charged today and after the pass", () => {
  const src = readFileSync(new URL("../app/api/stripe/checkout/route.ts", import.meta.url), "utf8");
  assert.ok(src.includes("custom_text: { submit: { message:"));
  assert.ok(src.includes("You pay $3 today for ${TRIAL_DAYS} days of Pro."));
});
