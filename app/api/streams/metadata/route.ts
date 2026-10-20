/**
 * POST /api/streams/metadata — real Twitch titles, durations and avatars for
 * the Streams page.
 *
 * Klyp stores clips as a source URL plus timestamps; it never stored the
 * VOD's own title, length or category. Rather than leave the page showing bare
 * ids, this asks Twitch for what it still has. Expired VODs come back absent —
 * Twitch deletes them after a few weeks — so the caller falls back to the id.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVideosByIds, getUsersByLogin, parseTwitchDuration } from "@/lib/twitch";

export const runtime = "nodejs";

export type VodMeta = { title: string; durationSeconds: number; createdAt: string };
export type ChannelMeta = { login: string; displayName: string; avatar: string };

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to load stream details." }, { status: 401 });
  }

  let videoIds: string[] = [];
  let logins: string[] = [];
  try {
    const body = await req.json();
    videoIds = Array.isArray(body.videoIds) ? body.videoIds.map(String).slice(0, 100) : [];
    logins = Array.isArray(body.logins) ? body.logins.map(String).slice(0, 100) : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const vods: Record<string, VodMeta> = {};
  const channels: Record<string, ChannelMeta> = {};

  // A Twitch outage or missing credentials must not break the page — the
  // caller's fallbacks cover everything this would have filled in.
  try {
    const videos = await getVideosByIds(videoIds);
    for (const v of videos) {
      vods[v.id] = {
        title: v.title,
        durationSeconds: parseTwitchDuration(v.duration),
        createdAt: v.created_at,
      };
    }
  } catch (err) {
    console.error("[streams/metadata] videos", err instanceof Error ? err.message : err);
  }

  try {
    const users = await getUsersByLogin(logins);
    for (const u of users) {
      channels[u.login.toLowerCase()] = {
        login: u.login,
        displayName: u.display_name,
        avatar: u.profile_image_url,
      };
    }
  } catch (err) {
    console.error("[streams/metadata] users", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ vods, channels });
}
