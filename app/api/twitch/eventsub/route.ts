/**
 * POST /api/twitch/eventsub — EventSub webhook receiver, processing service
 * only. Twitch has no "VOD created" event, so this only ever fires on
 * stream.offline; it queues a bounded retry-poll (see lib/vod-poll.ts) that
 * waits for the VOD to actually publish, since that takes Twitch a few
 * minutes after the stream ends.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyEventSubSignature } from "@/lib/twitch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** How long to wait after stream.offline before the first Get Videos check. */
const FIRST_CHECK_DELAY_MS = 3 * 60_000;

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return NextResponse.json({ error: "This endpoint only runs on the processing service." }, { status: 404 });
  }

  const rawBody = await req.text();
  const messageId = req.headers.get("twitch-eventsub-message-id");
  const timestamp = req.headers.get("twitch-eventsub-message-timestamp");
  const signature = req.headers.get("twitch-eventsub-message-signature");
  const messageType = req.headers.get("twitch-eventsub-message-type");

  if (!messageId || !timestamp || !verifyEventSubSignature(messageId, timestamp, rawBody, signature)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  const body = JSON.parse(rawBody);

  // Twitch's subscribe handshake — echo the challenge back verbatim.
  if (messageType === "webhook_callback_verification") {
    return new NextResponse(body.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  if (messageType === "revocation") {
    console.warn("[twitch eventsub] subscription revoked:", body.subscription?.id, body.subscription?.status);
    return NextResponse.json({ ok: true });
  }

  if (messageType === "notification" && body.subscription?.type === "stream.offline") {
    const broadcasterId = body.event?.broadcaster_user_id as string | undefined;
    if (broadcasterId) {
      const admin = createAdminClient();
      const { data: stream } = await admin
        .from("streams")
        .select("id")
        .eq("twitch_user_id", broadcasterId)
        .eq("auto_clip_enabled", true)
        .maybeSingle();

      if (stream) {
        // Twitch retries webhook delivery on a slow/missing 2xx — avoid piling
        // up duplicate checks for the same stream-end event.
        const { data: alreadyPending } = await admin
          .from("pending_vod_checks")
          .select("id")
          .eq("stream_id", stream.id)
          .limit(1)
          .maybeSingle();

        if (!alreadyPending) {
          await admin.from("pending_vod_checks").insert({
            stream_id: stream.id,
            check_after: new Date(Date.now() + FIRST_CHECK_DELAY_MS).toISOString(),
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
