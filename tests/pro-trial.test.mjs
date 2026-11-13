import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TRIAL_DAYS, TRIAL_SPARKS, cardTrialKey, emailTrialKey, normalizeEmail, proTrialOffered, trialMode } from "../lib/pro-trial.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const NEW = { tier: "free", stripe_customer_id: null, stripe_subscription_id: null };

test("the trial is 4 days with 250 Sparks, and is off unless PRO_TRIAL says ads or on", () => {
  assert.equal(TRIAL_DAYS, 4);
  assert.equal(TRIAL_SPARKS, 250);
  assert.equal(trialMode({}), "off");
  assert.equal(trialMode({ PRO_TRIAL: "" }), "off");
  assert.equal(trialMode({ PRO_TRIAL: "yes" }), "off");
  assert.equal(trialMode({ PRO_TRIAL: " ON " }), "on");
  assert.equal(trialMode({ PRO_TRIAL: "Ads" }), "ads");
});

test("who is offered it: off means nobody, ads means ad-link visitors, on means every new person; never someone who subscribed before", () => {
  assert.equal(proTrialOffered(NEW, "off", true), false);
  assert.equal(proTrialOffered(NEW, "ads", false), false);
  assert.equal(proTrialOffered(NEW, "ads", true), true);
  assert.equal(proTrialOffered(NEW, "on", false), true);
  assert.equal(proTrialOffered(null, "on", true), false);
  assert.equal(proTrialOffered({ ...NEW, tier: "pro" }, "on", true), false);
  assert.equal(proTrialOffered({ ...NEW, stripe_customer_id: "cus_1" }, "on", true), false, "came back after a subscription: no second trial");
  assert.equal(proTrialOffered({ ...NEW, stripe_subscription_id: "sub_1" }, "on", true), false);
  assert.equal(proTrialOffered({ ...NEW, complimentary_pro: true }, "on", true), false);
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

test("checkout starts a card-required 4-day trial for new monthly people only, and never stacks it with the $17 offer or a promo code", () => {
  const route = read("app/api/stripe/checkout/route.ts");
  assert.ok(route.includes('const trial = newMonthly && await trialOffered(req, profile, user.id, user.email);'));
  assert.ok(route.includes('...(trial ? { payment_method_collection: "always" as const } : {}),'));
  assert.ok(route.includes("...(trial ? { trial_period_days: TRIAL_DAYS } : {}),"));
  assert.ok(route.includes('...(trial ? { trial: "1" } : {})'));
  assert.ok(route.includes("const firstMonth = newMonthly && !trial && firstMonthOfferAvailable("));
  assert.ok(route.includes("const promoField = newMonthly && !firstMonth && !trial;"));
  assert.match(route, /try \{ return !\(await trialKeysUsedByOthers\(userId, \[emailTrialKey\(email\)\]\)\); \} catch \{ return false; \}/, "fails closed");
  assert.ok(route.includes("trial: trial ? { days: TRIAL_DAYS, sparks: TRIAL_SPARKS } : null,"));
});

test("the webhook gives 250 Sparks for the $0 trial invoice, 500 for the first real payment, and cancels a repeat trial before it gives anything", () => {
  const hook = read("app/api/stripe/webhook/route.ts");
  assert.ok(hook.includes('current.status === "trialing" && invoice.amount_paid === 0 && invoice.billing_reason === "subscription_create"'));
  assert.ok(hook.includes('subDetails?.metadata?.trial === "1"'));
  assert.ok(hook.includes("trialStart ? TRIAL_SPARKS : undefined"));
  assert.ok(hook.includes("p_balance: balance ?? SPARKS_ALLOWANCE[tier],"), "no balance override means the full allowance");
  assert.ok(hook.includes('(await claimTrialKeys(trialUserId, keys)) === "used"'));
  assert.ok(hook.includes("await getStripe().subscriptions.cancel(subscriptionId);"));
  assert.ok(hook.indexOf("claimTrialKeys(trialUserId, keys)") < hook.indexOf("trialStart ? TRIAL_SPARKS : undefined"), "the repeat check comes before the grant");
  assert.ok(hook.includes("cardTrialKey(fingerprint)"));
});

test("the used-trials table keeps both keys and only the server can read it", () => {
  const sql = read("supabase/migrations/051_trial_uses.sql");
  assert.match(sql, /create table if not exists public\.trial_uses/);
  assert.match(sql, /key\s+text primary key/);
  assert.match(sql, /alter table public\.trial_uses enable row level security;/);
  assert.doesNotMatch(sql, /create policy/i);
  const uses = read("lib/trial-uses.ts");
  assert.ok(uses.includes('error.code !== "23505"'), "a key that already exists is not an error");
  assert.ok(uses.includes("row.user_id !== userId"), "only a DIFFERENT account counts as a repeat");
});

test("the pages show the trial only when the server offers it, and name the card, the length and the Sparks", () => {
  const upgrade = read("app/(dashboard)/dashboard/upgrade/page.tsx");
  assert.ok(upgrade.includes("Start ${trial.days}-day free trial"));
  assert.ok(upgrade.includes("Card required."));
  assert.ok(upgrade.includes("Cancel any time before day {trial.days} and pay nothing."));
  const pricing = read("components/PricingSection.tsx");
  assert.ok(pricing.includes("Start ${trialDays}-day free trial"));
  assert.ok(pricing.includes("Card required. Cancel before day ${trialDays} and pay nothing."));
  assert.ok(read("app/page.tsx").includes('trialDays={trialMode() === "on" ? TRIAL_DAYS : 0}'), "the public page shows it only when it is on for everyone");
});
