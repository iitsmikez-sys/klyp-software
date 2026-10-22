import type Stripe from "stripe";
import { PRO_PRICE_CENTS } from "./stripe.ts";
import { proPriceMatchesOffer } from "./stripe-price.ts";

export type PaidSubscriptionGrant = {
  invoiceId: string;
  subscriptionId: string;
  customerId?: string;
  userId?: string;
  periodStart: number;
  periodEnd: number;
  paidEventCreated: number;
};

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

export function paidSubscriptionGrant(event: Stripe.Event): PaidSubscriptionGrant | null {
  if (event.type !== "invoice.paid") return null;
  const invoice = event.data.object;
  if (invoice.status !== "paid" || invoice.amount_paid <= 0) return null;
  if (invoice.billing_reason !== "subscription_create" && invoice.billing_reason !== "subscription_cycle") return null;
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  const customerId = idOf(invoice.customer);
  const userId = invoice.parent?.subscription_details?.metadata?.user_id;
  if (!invoice.id || !subscriptionId || (!customerId && !userId)) return null;
  const line = invoice.lines.data.find((item) =>
    item.parent?.type === "subscription_item_details" &&
    item.parent.subscription_item_details?.subscription === subscriptionId &&
    item.parent.subscription_item_details.proration === false
  );
  if (!line || !Number.isSafeInteger(line.period.start) ||
    !Number.isSafeInteger(line.period.end) || line.period.end <= line.period.start ||
    !Number.isSafeInteger(event.created)) return null;
  return {
    invoiceId: invoice.id, subscriptionId, customerId, userId,
    periodStart: line.period.start, periodEnd: line.period.end,
    paidEventCreated: event.created,
  };
}

export function shouldDowngradeSubscription(status: string): boolean {
  return ["canceled", "unpaid", "incomplete_expired", "paused"].includes(status);
}

export function paidSubscriptionIsActive(
  subscription: Stripe.Subscription, grant: PaidSubscriptionGrant, configuredPriceId?: string
): boolean {
  const klypUserId = subscription.metadata?.user_id;
  const items = subscription.items.data;
  // Existing subscribers may renew after their price is archived. The billed
  // amount and interval still have to match the offer.
  const price = items.length === 1 ? items[0].price : null;
  return subscription.id === grant.subscriptionId && subscription.status === "active" &&
    (!grant.customerId || idOf(subscription.customer) === grant.customerId) &&
    !!klypUserId && (!grant.userId || klypUserId === grant.userId) &&
    (!subscription.metadata.klyp_plan || subscription.metadata.klyp_plan === "pro") &&
    !!price && (!configuredPriceId || price.id === configuredPriceId) &&
    proPriceMatchesOffer({ ...price, active: true }, PRO_PRICE_CENTS);
}
