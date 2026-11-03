/**
 * POST /api/stripe/packs {pack: "p100" | "p250" | "p500"} — start a one-time Stripe Checkout for a Spark pack.
 * The webhook (checkout.session.completed) and the repair sync (lib/spark-packs-sync.ts) add the Sparks once
 * the payment is confirmed; nothing is granted here.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { packById } from "@/lib/spark-packs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to buy Sparks." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { pack?: unknown };
  const pack = packById(body?.pack);
  if (!pack) return NextResponse.json({ error: "Choose a Spark pack." }, { status: 400 });

  try {
    const profile = await getProfile().catch(() => null);
    const origin = req.nextUrl.origin;
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: pack.cents,
          product_data: { name: `${pack.sparks} Klyp Sparks`, description: "One-time Spark pack. Never expires." },
        },
        quantity: 1,
      }],
      ...(profile?.stripe_customer_id ? { customer: profile.stripe_customer_id } : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      metadata: { kind: "spark_pack", user_id: user.id, pack: pack.id },
      success_url: `${origin}/dashboard?pack=1`,
      cancel_url: `${origin}/dashboard/upgrade`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start checkout." }, { status: 500 });
  }
}
