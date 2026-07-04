/**
 * POST /api/stripe/portal — open the Stripe billing portal so Pro users can
 * manage or cancel their subscription.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getProfile } from "@/lib/profile";

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
  if (!profile.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account yet — upgrade to Pro first." }, { status: 400 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
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
