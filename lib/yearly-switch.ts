/**
 * Switch a paid monthly Pro subscriber to the yearly plan ($276/year, 18% less than twelve months).
 *
 * Stripe does the money: changing the interval starts a new yearly term today, credits the unused part
 * of the current month and charges the rest (`always_invoice`), and `error_if_incomplete` makes a
 * declined card fail the whole switch instead of leaving a half-changed subscription. Sparks are left
 * alone: the person keeps their balance and the usual monthly refill (migration 041) continues from
 * their current reset date.
 *
 * Refused (never charged) when the switch would be unfair or unclear: already yearly, a cancellation is
 * scheduled, billing is paused, or a discount is attached (the one-payment 40% off would otherwise land
 * on the $276 invoice).
 */
import { PRO_YEARLY_PRICE_CENTS } from "./stripe.ts";

type IdOrObject = string | { id: string } | null | undefined;
const idOf = (v: IdOrObject): string | undefined => (!v ? undefined : typeof v === "string" ? v : v.id);

export type YearlySub = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  pause_collection: unknown | null;
  discounts?: unknown[];
  metadata?: Record<string, string> | null;
  items: { data: Array<{ id: string; current_period_end?: number; price?: { product?: IdOrObject; recurring?: { interval?: string } | null } }> };
  latest_invoice?: { amount_paid?: number } | string | null;
};

export type YearlyStripe = {
  subscriptions: {
    retrieve(id: string, params?: Record<string, unknown>): Promise<YearlySub>;
    update(id: string, params: Record<string, unknown>): Promise<YearlySub>;
  };
  prices: {
    retrieve(id: string): Promise<{ active: boolean; unit_amount: number | null; currency: string; recurring: { interval: string } | null }>;
  };
};
export type YearlyAdmin = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

export type YearlyResult = { status: number; body: Record<string, unknown> };
type Deps = { stripe: YearlyStripe; admin: YearlyAdmin; configuredYearlyPriceId?: string | null };
type Ctx = { userId: string; subscriptionId: string };

const FAIL_STRIPE = "We couldn't reach Stripe to make that change. Nothing was changed and you have not been charged. Please try again.";

export type Eligibility = { eligible: true } | { eligible: false; code: string; message: string };

export function yearlyEligibility(sub: YearlySub): Eligibility {
  const item = sub.items.data[0];
  const interval = item?.price?.recurring?.interval;
  if (sub.status !== "active") return { eligible: false, code: "not_active", message: "Your subscription needs to be active to switch plans." };
  if (interval === "year") return { eligible: false, code: "already_yearly", message: "You're already on the yearly plan." };
  if (interval !== "month" || !item) return { eligible: false, code: "not_monthly", message: "Only monthly plans can switch to yearly." };
  if (sub.cancel_at_period_end) return { eligible: false, code: "cancelling", message: "Undo your cancellation first, then you can switch to yearly." };
  if (sub.pause_collection) return { eligible: false, code: "paused", message: "Billing is paused. Switch to yearly once it resumes." };
  if ((sub.discounts ?? []).length > 0) return { eligible: false, code: "discounted", message: "Your discounted month needs to finish first. Then you can switch to yearly." };
  return { eligible: true };
}

async function read(deps: Deps, id: string): Promise<YearlySub> {
  return deps.stripe.subscriptions.retrieve(id, { expand: ["discounts"] });
}

export async function getYearlyState(deps: Deps, ctx: Ctx): Promise<YearlyResult> {
  let sub: YearlySub;
  try { sub = await read(deps, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  const e = yearlyEligibility(sub);
  return { status: 200, body: e.eligible ? { eligible: true, price_cents: PRO_YEARLY_PRICE_CENTS } : { ...e } };
}

export async function switchToYearly(deps: Deps, ctx: Ctx): Promise<YearlyResult> {
  let sub: YearlySub;
  try { sub = await read(deps, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  const e = yearlyEligibility(sub);
  if (!e.eligible) return { status: 409, body: { code: e.code, error: e.message } };
  const item = sub.items.data[0];

  // A configured yearly Price must match the advertised offer; otherwise the price is built from the
  // same product the person already pays for.
  let price: Record<string, unknown>;
  try {
    if (deps.configuredYearlyPriceId) {
      const p = await deps.stripe.prices.retrieve(deps.configuredYearlyPriceId);
      if (!p.active || p.unit_amount !== PRO_YEARLY_PRICE_CENTS || p.currency !== "usd" || p.recurring?.interval !== "year") {
        return { status: 500, body: { error: "The yearly price is not set up correctly. Please contact support." } };
      }
      price = { price: deps.configuredYearlyPriceId };
    } else {
      const product = idOf(item.price?.product);
      if (!product) return { status: 500, body: { error: "We couldn't find your plan to change it. Please contact support." } };
      price = { price_data: { currency: "usd", product, unit_amount: PRO_YEARLY_PRICE_CENTS, recurring: { interval: "year" } } };
    }
  } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }

  let updated: YearlySub;
  try {
    updated = await deps.stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, ...price }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      metadata: { ...(sub.metadata ?? {}), billing_interval: "year" },
      expand: ["latest_invoice"],
    });
  } catch (err) {
    const declined = !!err && typeof err === "object" && /card|payment|declin/i.test(String((err as { message?: string }).message ?? ""));
    return { status: declined ? 402 : 502, body: {
      error: declined
        ? "Your card couldn't be charged, so your plan was not changed. Update your card in Manage billing and try again."
        : FAIL_STRIPE,
    } };
  }

  // The plan is now yearly in Stripe. Record it; if this write is lost, the webhook's
  // subscription.updated handler records it too.
  try {
    const { error } = await deps.admin.from("profiles").update({ billing_interval: "year" })
      .eq("id", ctx.userId).eq("stripe_subscription_id", sub.id);
    if (error) throw error;
  } catch { /* self-heals from the webhook */ }

  const charged = typeof updated.latest_invoice === "object" && updated.latest_invoice ? updated.latest_invoice.amount_paid ?? null : null;
  return { status: 200, body: { ok: true, charged_cents: charged } };
}
