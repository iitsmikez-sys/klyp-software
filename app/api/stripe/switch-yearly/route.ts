/**
 * GET  /api/stripe/switch-yearly — can this signed-in Pro subscriber switch to the yearly plan?
 * POST /api/stripe/switch-yearly — do it. Rules live in lib/yearly-switch.ts; this only authenticates.
 */
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/profile";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getYearlyState, switchToYearly, type YearlyAdmin, type YearlyStripe } from "@/lib/yearly-switch";

export const runtime = "nodejs";

async function run(action: "state" | "switch") {
  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load profile." }, { status: 500 });
  }
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (profile.tier !== "pro" || !profile.stripe_subscription_id) {
    return NextResponse.json({ code: "no_subscription", error: "There is no paid subscription on this account." }, { status: 409 });
  }
  const deps = {
    stripe: getStripe() as unknown as YearlyStripe,
    admin: createAdminClient() as unknown as YearlyAdmin,
    configuredYearlyPriceId: process.env.STRIPE_PRICE_PRO_YEARLY || null,
  };
  const ctx = { userId: profile.id, subscriptionId: profile.stripe_subscription_id };
  const result = action === "state" ? await getYearlyState(deps, ctx) : await switchToYearly(deps, ctx);
  return NextResponse.json(result.body, { status: result.status });
}

export const GET = () => run("state");
export const POST = () => run("switch");
