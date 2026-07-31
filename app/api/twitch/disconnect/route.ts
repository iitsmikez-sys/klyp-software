/**
 * POST /api/twitch/disconnect { streamId } — removes a connected Twitch
 * channel. Must go through this route (not a plain client-side delete) so the
 * EventSub subscription gets cleaned up — otherwise Twitch keeps pushing
 * stream.offline events for a channel Klyp no longer tracks.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteEventSubSubscription } from "@/lib/twitch";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const streamId = body?.streamId ? String(body.streamId) : null;
  if (!streamId) {
    return NextResponse.json({ error: "streamId is required." }, { status: 400 });
  }

  // RLS (auth.uid() = user_id) scopes this to the caller's own row.
  const { data: stream, error: fetchError } = await supabase
    .from("streams")
    .select("id, eventsub_subscription_id")
    .eq("id", streamId)
    .single();
  if (fetchError || !stream) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  if (stream.eventsub_subscription_id) {
    try {
      await deleteEventSubSubscription(stream.eventsub_subscription_id);
    } catch (err) {
      // Log but don't block disconnect on this — an orphaned subscription on
      // Twitch's side is harmless noise, not a reason to strand the user's row.
      console.error("[twitch disconnect] failed to delete EventSub subscription:", err);
    }
  }

  const { error: deleteError } = await supabase.from("streams").delete().eq("id", streamId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
