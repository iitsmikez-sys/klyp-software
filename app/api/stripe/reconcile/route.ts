/**
 * GET|POST /api/stripe/reconcile — daily sweep that repairs missed webhooks.
 *
 * Finds Pro subscribers whose renewal date passed more than two days ago (a renewal
 * grant or a cancellation never arrived), reads their real state from Stripe and
 * applies it with the same idempotent rules as the webhook (lib/stripe-sync.ts).
 *
 * The same daily run also tops up yearly subscribers' monthly Sparks (lib/yearly-refill.ts).
 *
 * Protected by CRON_SECRET, sent as "Authorization: Bearer <secret>" (which is what
 * Vercel Cron does when CRON_SECRET is set). Nothing schedules this for you: add a
 * daily cron entry for /api/stripe/reconcile yourself (see .env.example).
 */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileStuckPro, type StripeSyncClient } from "@/lib/stripe-sync";
import { refillYearlySparks, type RefillStripe } from "@/lib/yearly-refill";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const summary = await reconcileStuckPro({
      stripe: getStripe() as unknown as StripeSyncClient,
      admin: createAdminClient() as never,
    });
    if (summary.failed > 0) console.error("[stripe reconcile] failures:", summary.errors);
    // The same daily run tops up yearly subscribers' monthly Sparks. A failure here must not hide the
    // reconcile result above (or the other way round), so it reports its own outcome.
    let yearlyRefill: unknown;
    try {
      const refill = await refillYearlySparks({ stripe: getStripe() as unknown as RefillStripe, admin: createAdminClient() as never });
      if (refill.failed > 0) console.error("[yearly refill] failures:", refill.errors);
      yearlyRefill = refill;
    } catch (err) {
      console.error("[yearly refill] failed:", err);
      yearlyRefill = { error: err instanceof Error ? err.message : "Yearly refill failed." };
    }
    return NextResponse.json({ ok: true, ...summary, yearlyRefill });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reconcile failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
