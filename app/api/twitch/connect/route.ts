/**
 * GET /api/twitch/connect — starts the Twitch OAuth identify flow for
 * connecting a channel to auto-clipping. Redirects to Twitch; the user comes
 * back at /api/twitch/callback with a one-time code.
 */
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { twitchAuthorizeUrl } from "@/lib/twitch";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/twitch/callback", req.url).toString();

  const res = NextResponse.redirect(twitchAuthorizeUrl(redirectUri, state));
  res.cookies.set("twitch_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
