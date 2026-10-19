/**
 * POST /api/vod-thumbnails — resolve source-VOD poster images for clip cards.
 *
 * Klyp stores clips as VOD timestamps, not rendered files, so there is no clip
 * thumbnail to serve. The next-best real image is the source VOD's own poster,
 * which Twitch exposes on Helix /videos. YouTube is resolved client-side from
 * the video id (see localThumbnailUrl) and never reaches this route.
 *
 * Takes the clip URLs as-is and answers with a { url -> image | null } map, so
 * the caller doesn't have to know how ids are parsed per platform.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVideosByIds, twitchThumbnailAt } from "@/lib/twitch";
import { twitchVodId } from "@/lib/clip-ui";

export const runtime = "nodejs";

/** 16:9, comfortably sharp on a 2x display at the card's rendered width. */
const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 360;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to load clip thumbnails." }, { status: 401 });
  }

  let urls: string[];
  try {
    const body = await req.json();
    urls = Array.isArray(body.urls) ? body.urls.map(String) : [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // One Helix call covers up to 100 ids; beyond that the extras simply resolve
  // to null and the cards fall back to the placeholder.
  const idByUrl = new Map<string, string>();
  for (const url of urls) {
    const id = twitchVodId(url);
    if (id) idByUrl.set(url, id);
  }

  const thumbnails: Record<string, string | null> = {};
  for (const url of urls) thumbnails[url] = null;

  if (idByUrl.size > 0) {
    try {
      const videos = await getVideosByIds(Array.from(new Set(Array.from(idByUrl.values()))));
      const byId = new Map(videos.map((v) => [v.id, v]));
      idByUrl.forEach((id, url) => {
        thumbnails[url] = twitchThumbnailAt(byId.get(id)?.thumbnail_url, THUMB_WIDTH, THUMB_HEIGHT);
      });
    } catch (err) {
      // A Twitch outage or missing credentials shouldn't break My Clips —
      // every card just renders its fallback instead.
      console.error("[vod-thumbnails]", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ thumbnails });
}
