/**
 * POST /api/stripe/checkout — start a Pro subscription checkout.
 *
 * Uses STRIPE_PRICE_PRO if set; otherwise creates the $28/mo price inline so
 * the flow works with nothing but STRIPE_SECRET_KEY configured.
 * The webhook (app/api/stripe/webhook) flips the profile to Pro on completion.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe, PRO_PRICE_CENTS } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile." },
      { status: 500 }
    );
  }
  // Same "confirmed subscription" check as SparksProvider.tsx — if tier says
  // pro but there's no subscription_id behind it, let checkout proceed rather
  // than block a user who needs to get a real subscription.
  if (profile?.tier === "pro" && profile.stripe_subscription_id) {
    return NextResponse.json({ error: "You're already on Pro." }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        process.env.STRIPE_PRICE_PRO
          ? { price: process.env.STRIPE_PRICE_PRO, quantity: 1 }
          : {
              price_data: {
                currency: "usd",
                unit_amount: PRO_PRICE_CENTS,
                recurring: { interval: "month" },
                product_data: {
                  name: "Klyp Pro",
                  description: "500 Sparks/month, no watermark",
                },
              },
              quantity: 1,
            },
      ],
      // Reuse the Stripe customer if this user subscribed before.
      ...(profile?.stripe_customer_id
        ? { customer: profile.stripe_customer_id }
        : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start checkout." },
      { status: 500 }
    );
  }
}
