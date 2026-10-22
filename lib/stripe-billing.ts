/** Resolve profile billing IDs against the Stripe account used by this deployment. */
type BillingClient = {
  customers: { retrieve(id: string): Promise<{ id: string; deleted?: boolean | void }> };
  subscriptions: {
    retrieve(id: string): Promise<{ status: string; customer: string | { id: string } }>;
  };
};

type BillingReferences = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function isMissingResource(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error &&
    error.code === "resource_missing";
}

export async function resolveBillingState(
  stripe: BillingClient,
  refs: BillingReferences
): Promise<{ checkoutCustomerId: string | null; portalCustomerId: string | null }> {
  if (refs.stripe_subscription_id) {
    try {
      const subscription = await stripe.subscriptions.retrieve(refs.stripe_subscription_id);
      if (["active", "trialing", "past_due"].includes(subscription.status)) {
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
        return { checkoutCustomerId: customerId, portalCustomerId: customerId };
      }
    } catch (error) {
      if (!isMissingResource(error)) throw error;
    }
  }

  if (refs.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(refs.stripe_customer_id);
      if (!customer.deleted) {
        return { checkoutCustomerId: customer.id, portalCustomerId: null };
      }
    } catch (error) {
      if (!isMissingResource(error)) throw error;
    }
  }

  return { checkoutCustomerId: null, portalCustomerId: null };
}
