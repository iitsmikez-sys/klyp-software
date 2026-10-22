/**
 * POST /api/stripe/portal — open the Stripe billing portal so Pro users can
 * manage or cancel their subscription.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getProfile } from "@/lib/profile";
import { resolveBillingState } from "@/lib/stripe-billing";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile." },
      { status: 500 }
    );
  }
  if (!profile) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    const stripe = getStripe();
    const billing = await resolveBillingState(stripe, profile);
    if (!billing.portalCustomerId) {
      return NextResponse.json({
        code: "billing_account_missing",
        error: "No active subscription exists in this Stripe account. Set up billing to subscribe.",
      }, { status: 409 });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: billing.portalCustomerId,
      return_url: `${req.nextUrl.origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to open billing portal." },
      { status: 500 }
    );
  }
}
