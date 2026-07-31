/**
 * GET /api/twitch/callback — finishes the Twitch OAuth identify flow: exchanges
 * the code, identifies the Twitch user, upserts a `streams` row, and registers
 * a stream.offline EventSub subscription (delivered to the processing service,
 * which owns the auto-clip retry-poll pipeline — see app/api/twitch/eventsub).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeTwitchCode, getTwitchUser, createStreamOfflineSubscription } from "@/lib/twitch";

export const runtime = "nodejs";

function redirectWithStatus(req: NextRequest, status: string) {
  const url = new URL("/dashboard/streams", req.url);
  url.searchParams.set("twitch", status);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = req.cookies.get("twitch_oauth_state")?.value;

  const res = (() => {
    if (!code || !state || !expectedState || state !== expectedState) {
      return redirectWithStatus(req, "state_mismatch");
    }
    return null;
  })();
  if (res) {
    res.cookies.delete("twitch_oauth_state");
    return res;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirectWithStatus(req, "not_signed_in");
  }

  try {
    const redirectUri = new URL("/api/twitch/callback", req.url).toString();
    const userToken = await exchangeTwitchCode(code!, redirectUri);
    const twitchUser = await getTwitchUser(userToken);

    const channelUrl = `https://www.twitch.tv/${twitchUser.login}`;
    const { data: existing } = await supabase
      .from("streams")
      .select("id, eventsub_subscription_id")
      .eq("user_id", user.id)
      .eq("twitch_user_id", twitchUser.id)
      .maybeSingle();

    let streamId = existing?.id as string | undefined;
    if (!streamId) {
      const { data: inserted, error: insertError } = await supabase
        .from("streams")
        .insert({
          user_id: user.id,
          platform: "twitch",
          channel_url: channelUrl,
          twitch_user_id: twitchUser.id,
          twitch_login: twitchUser.login,
        })
        .select("id")
        .single();
      if (insertError) {
        // 23505 = unique violation — either this exact row (race) or someone
        // else already connected this Twitch channel (streams_twitch_user_id_key).
        const final = redirectWithStatus(
          req,
          insertError.code === "23505" ? "already_connected" : "save_failed"
        );
        final.cookies.delete("twitch_oauth_state");
        return final;
      }
      streamId = inserted.id;
    }

    // (Re)register the EventSub subscription if this connection doesn't have
    // one yet — connecting again after a partial failure shouldn't double-subscribe.
    if (!existing?.eventsub_subscription_id) {
      const processingBase = process.env.NEXT_PUBLIC_PROCESSING_API_URL;
      if (!processingBase) throw new Error("NEXT_PUBLIC_PROCESSING_API_URL is not set.");
      const callbackUrl = `${processingBase}/api/twitch/eventsub`;
      const subscriptionId = await createStreamOfflineSubscription(twitchUser.id, callbackUrl);
      await supabase.from("streams").update({ eventsub_subscription_id: subscriptionId }).eq("id", streamId);
    }

    const final = redirectWithStatus(req, "connected");
    final.cookies.delete("twitch_oauth_state");
    return final;
  } catch (err) {
    console.error("[twitch callback] failed:", err);
    const final = redirectWithStatus(req, "error");
    final.cookies.delete("twitch_oauth_state");
    return final;
  }
}
