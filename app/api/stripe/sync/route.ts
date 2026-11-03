/**
 * POST /api/stripe/sync — bring the signed-in user's plan in line with Stripe NOW.
 *
 * Used right after checkout (the success page can load before the webhook lands)
 * and for restoring a purchase. It applies the same invoice-keyed, idempotent rules
 * as the webhook (see lib/stripe-sync.ts), so it can never grant a billing period
 * twice, however often it runs or whichever of this and the webhook gets there first.
 */
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { rateLimit } from "@/lib/request-rate-limit";
import { syncUserFromStripe, type StripeSyncClient } from "@/lib/stripe-sync";
import { syncSparkPacks, type PackSyncStripe } from "@/lib/spark-packs-sync";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const limited = rateLimit(`stripe-sync:${user.id}`, 6, 60_000);
  if (!limited.ok) {
    const res = NextResponse.json({ error: "Too many requests — try again in a moment." }, { status: 429 });
    res.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return res;
  }

  try {
    const profile = await getProfile();
    const result = await syncUserFromStripe({
      stripe: getStripe() as unknown as StripeSyncClient,
      admin: createAdminClient() as never,
      userId: user.id,
      customerId: profile?.stripe_customer_id ?? null,
    });
    // Also credit any Spark pack paid in the last few days whose webhook has not landed (idempotent).
    let packsCredited = 0;
    try {
      const packs = await syncSparkPacks({ stripe: getStripe() as unknown as PackSyncStripe, admin: createAdminClient() as never, userId: user.id });
      packsCredited = packs.credited;
    } catch (err) {
      console.error("[stripe sync] spark pack repair failed:", err);
    }
    return NextResponse.json({
      ok: true,
      packsCredited,
      subscriptions: result.subscriptions,
      changed: result.outcomes.some((o) => o.action === "granted" || o.action === "revoked"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't check your subscription." },
      { status: 500 }
    );
  }
}
