/**
 * POST /api/streams/auto-clip — turn auto-clipping on or off for one channel.
 *
 * public.streams has select/insert/delete policies but no update policy, so a
 * browser write would be silently rejected by RLS and the toggle would lie.
 * This authenticates the user from their session, checks they own the row,
 * and performs the update with the service-role client — ownership is enforced
 * here rather than by a policy that doesn't exist.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasAutoClipAccess } from "@/lib/auto-clip-entitlement";
import { AUTO_CLIP_PRO_MESSAGE } from "@/lib/plan-limits";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to change this." }, { status: 401 });
  }

  let streamId: string;
  let enabled: boolean;
  try {
    const body = await req.json();
    streamId = String(body.streamId ?? "");
    enabled = Boolean(body.enabled);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!streamId) {
    return NextResponse.json({ error: "Missing streamId." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ownership check, since the service-role client bypasses RLS entirely.
  const { data: row, error: readErr } = await admin
    .from("streams")
    .select("id, user_id")
    .eq("id", streamId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: "Couldn't load that channel." }, { status: 500 });
  }
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  // Automatic clipping is a Pro feature: turning it ON is refused for Free (turning it off is always allowed).
  if (enabled) {
    let allowed: boolean;
    try {
      allowed = await hasAutoClipAccess(admin, user.id);
    } catch {
      return NextResponse.json({ error: "Couldn't check your plan. Please try again." }, { status: 500 });
    }
    if (!allowed) {
      return NextResponse.json({ error: AUTO_CLIP_PRO_MESSAGE }, { status: 403 });
    }
  }

  const { error } = await admin
    .from("streams")
    .update({ auto_clip_enabled: enabled })
    .eq("id", streamId);
  if (error) {
    return NextResponse.json({ error: "Couldn't save that change." }, { status: 500 });
  }
  if (!enabled) {
    // Finish RPC also checks this flag under a row lock, so a processing job
    // cannot commit a charge after the disable has taken effect.
    const { error: cancelError } = await admin.from("auto_vod_jobs")
      .update({ status: "canceled", lease_until: null })
      .eq("stream_id", streamId).in("status", ["pending", "retry", "processing"]);
    if (cancelError) return NextResponse.json({ error: "Auto-clipping was disabled, but queued work could not be cleared." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled });
}
