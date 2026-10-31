import { NextRequest, NextResponse } from 'next/server';
import { POST as renderClip } from '@/app/api/clip/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { bearerToken, getProfileFromToken } from '@/lib/profile-token';
import { withCors, corsPreflight } from '@/lib/cors';
import { youtubeConfig, youtubeTokenKey } from '@/lib/youtube-config';
import { refreshYouTubeAccessToken, uploadToYouTube, YouTubeUploadError } from '@/lib/youtube-api';
import { decryptRefreshToken, isConfirmedPro, validateYouTubePost } from '@/lib/youtube-publishing';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const OPTIONS = corsPreflight;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<Response> {
  return withCors(await publish(req));
}

async function publish(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== 'processing') {
    return NextResponse.json({ error: 'YouTube publishing runs on the processing service.' }, { status: 404 });
  }
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const profile = await getProfileFromToken(token);
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!isConfirmedPro(profile)) {
    return NextResponse.json({ error: 'Posting to YouTube requires an active Pro subscription.' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  let details;
  let clipPayload: Record<string, unknown>;
  let clipId: string;
  let requestKey: string;
  try {
    const raw = await req.text();
    if (raw.length > 256_000) throw new Error('The clip request is too large.');
    body = JSON.parse(raw) as Record<string, unknown>;
    clipPayload = body.clipPayload as Record<string, unknown>;
    clipId = String(clipPayload?.clip_id ?? '');
    requestKey = String(body.requestKey ?? '');
    if (!UUID.test(clipId) || !UUID.test(requestKey)) throw new Error('Choose a saved clip to publish.');
    details = validateYouTubePost({ title: body.title, description: body.description, publishAt: body.publishAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube post.' }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: clip, error: clipError } = await admin.from('clips').select('id')
    .eq('id', clipId).eq('user_id', profile.id).maybeSingle();
  if (clipError) return NextResponse.json({ error: 'Could not load this clip.' }, { status: 500 });
  if (!clip) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 });
  const { data: connection, error: connectionError } = await admin.from('youtube_connections')
    .select('refresh_token_enc').eq('user_id', profile.id).maybeSingle();
  if (connectionError) return NextResponse.json({ error: 'Could not check YouTube connection.' }, { status: 500 });
  if (!connection) return NextResponse.json({ error: 'Connect your YouTube channel first.' }, { status: 409 });

  const { data: post, error: insertError } = await admin.from('youtube_posts').insert({
    user_id: profile.id, clip_id: clipId, request_key: requestKey,
    title: details.title, description: details.description, publish_at: details.publishAt,
    status: 'processing',
  }).select('id').single();
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await admin.from('youtube_posts')
        .select('id,status,youtube_video_id,publish_at,error')
        .eq('user_id', profile.id).eq('request_key', requestKey).maybeSingle();
      if (existing) return NextResponse.json({ ...existing,
        youtubeUrl: existing.youtube_video_id ? `https://www.youtube.com/watch?v=${existing.youtube_video_id}` : null });
      const { data: unresolved } = await admin.from('youtube_posts')
        .select('id,status').eq('user_id', profile.id).eq('clip_id', clipId)
        .in('status', ['processing', 'needs_review']).maybeSingle();
      if (unresolved) return NextResponse.json({
        error: 'A YouTube upload for this clip is still processing or needs review. Check your channel before starting another one.',
        status: unresolved.status,
      }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not start YouTube publishing.' }, { status: 500 });
  }

  let acceptedVideoId: string | null = null;
  try {
    const config = youtubeConfig();
    const refreshToken = decryptRefreshToken(connection.refresh_token_enc, youtubeTokenKey());
    const accessToken = await refreshYouTubeAccessToken(config, refreshToken);
    const renderRequest = new NextRequest(new URL('/api/clip', req.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...clipPayload, clip_id: clipId, raw: false, upscale: false }),
    });
    const rendered = await renderClip(renderRequest);
    if (!rendered.ok) {
      const message = (await rendered.json().catch(() => null))?.error ?? 'Clip rendering failed.';
      throw new Error(message);
    }
    if (!rendered.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('The export was not an MP4 video.');
    const bytes = Buffer.from(await rendered.arrayBuffer());
    if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('The finished clip exceeds the YouTube publishing size limit.');
    // Rendering can take minutes. Never hand YouTube a now-expired schedule.
    if (details.publishAt) validateYouTubePost(details);
    const videoId = await uploadToYouTube({ ...details, accessToken, bytes });
    acceptedVideoId = videoId;
    const status = details.publishAt ? 'scheduled' : 'uploaded';
    const { error: saveError } = await admin.from('youtube_posts').update({
      status, youtube_video_id: videoId, error: null, updated_at: new Date().toISOString(),
    }).eq('id', post.id);
    if (saveError) throw new Error('YouTube accepted the video, but Klyp could not save its status. Check your channel before retrying.');
    return NextResponse.json({ id: post.id, status, youtubeUrl: `https://www.youtube.com/watch?v=${videoId}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube publishing failed.';
    if (error instanceof YouTubeUploadError && error.videoId) acceptedVideoId = error.videoId;
    const status = acceptedVideoId || error instanceof YouTubeUploadError && error.mayHaveReachedYouTube
      ? 'needs_review' : 'failed';
    await admin.from('youtube_posts').update({ status, error: message.slice(0, 500),
      ...(acceptedVideoId ? { youtube_video_id: acceptedVideoId } : {}),
      updated_at: new Date().toISOString() }).eq('id', post.id);
    return NextResponse.json({ id: post.id, status, error: message,
      youtubeUrl: acceptedVideoId ? `https://www.youtube.com/watch?v=${acceptedVideoId}` : null,
    }, { status: status === 'needs_review' ? 502 : 500 });
  }
}
