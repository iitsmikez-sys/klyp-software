/**
 * GET|POST /api/stripe/reconcile — daily sweep that repairs missed webhooks.
 *
 * Finds Pro subscribers whose renewal date passed more than two days ago (a renewal
 * grant or a cancellation never arrived), reads their real state from Stripe and
 * applies it with the same idempotent rules as the webhook (lib/stripe-sync.ts).
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
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reconcile failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
