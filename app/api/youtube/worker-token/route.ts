import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refreshYouTubeAccessToken } from '@/lib/youtube-api';
import { youtubeConfig, youtubeTokenKey } from '@/lib/youtube-config';
import { decryptRefreshToken } from '@/lib/youtube-publishing';
import { verifyWorkerTokenRequest } from '@/lib/youtube-worker-token';

export const runtime = 'nodejs';

function reply(body: Record<string, unknown>, status: number): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Only Klyp's processing service may request a short-lived token for an active post. */
export async function POST(req: Request): Promise<Response> {
  const sharedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sharedSecret) return reply({ error: 'YouTube publishing is not configured.' }, 503);
  let postId: string;
  try {
    const raw = await req.text();
    if (raw.length > 256) return reply({ error: 'Invalid request.' }, 400);
    postId = String((JSON.parse(raw) as { postId?: unknown }).postId ?? '');
  } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (!verifyWorkerTokenRequest(postId,
    req.headers.get('x-klyp-token-timestamp') ?? '',
    req.headers.get('x-klyp-token-signature') ?? '', sharedSecret)) {
    return reply({ error: 'Unauthorized.' }, 401);
  }
  const admin = createAdminClient();
  const { data: post, error: postError } = await admin.from('youtube_posts')
    .select('user_id,status').eq('id', postId).maybeSingle();
  if (postError) return reply({ error: 'Could not load the YouTube post.' }, 500);
  if (!post || post.status !== 'processing') return reply({ error: 'This YouTube post is not processing.' }, 409);
  const { data: connection, error: connectionError } = await admin.from('youtube_connections')
    .select('refresh_token_enc').eq('user_id', post.user_id).maybeSingle();
  if (connectionError) return reply({ error: 'Could not load the YouTube connection.' }, 500);
  if (!connection) return reply({ error: 'Reconnect your YouTube channel.' }, 409);
  try {
    const refreshToken = decryptRefreshToken(connection.refresh_token_enc, youtubeTokenKey());
    const accessToken = await refreshYouTubeAccessToken(youtubeConfig(), refreshToken);
    return reply({ accessToken }, 200);
  } catch (error) {
    console.error('[youtube worker token] authorization failed', error instanceof Error ? error.message : error);
    return reply({ error: 'YouTube authorization failed. Reconnect your channel.' }, 502);
  }
}
