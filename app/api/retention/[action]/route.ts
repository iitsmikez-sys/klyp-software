/**
 * /api/retention/<action> — the cancellation survey and its offers (state, survey, discount, pause,
 * cancel, undo-cancel). Signed-in Pro subscribers with a Stripe subscription only. All the rules
 * live in lib/retention-core.ts; this file only authenticates and forwards.
 */
import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/profile";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRetentionAction, type RetentionAdmin, type RetentionStripe } from "@/lib/retention-core";

export const runtime = "nodejs";

async function handle(req: NextRequest, action: string, body: Record<string, unknown>) {
  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load profile." }, { status: 500 });
  }
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (profile.tier !== "pro" || !profile.stripe_subscription_id) {
    return NextResponse.json(
      { code: "no_subscription", error: "There is no paid subscription on this account to cancel." },
      { status: 409 },
    );
  }
  const result = await runRetentionAction(
    { stripe: getStripe() as unknown as RetentionStripe, admin: createAdminClient() as unknown as RetentionAdmin },
    { userId: profile.id, subscriptionId: profile.stripe_subscription_id },
    action,
    body,
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "state") return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  return handle(req, action, {});
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action === "state") return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(req, action, body && typeof body === "object" ? body : {});
}
