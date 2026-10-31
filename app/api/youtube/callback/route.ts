import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeYouTubeCode } from '@/lib/youtube-api';
import { youtubeConfig, youtubeTokenKey } from '@/lib/youtube-config';
import { encryptRefreshToken, isConfirmedPro } from '@/lib/youtube-publishing';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const clipId = req.cookies.get('youtube_oauth_clip')?.value;
  const destination = clipId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clipId)
    ? `/dashboard/clips/${clipId}/edit` : '/dashboard/clips';
  const finish = (status: string) => {
    const url = new URL(destination, req.url);
    url.searchParams.set('youtube', status);
    const response = NextResponse.redirect(url);
    response.cookies.delete('youtube_oauth_state');
    response.cookies.delete('youtube_oauth_clip');
    response.cookies.delete('youtube_oauth_user');
    return response;
  };
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const expected = req.cookies.get('youtube_oauth_state')?.value;
  if (!state || !expected || state !== expected || !code) return finish('connection_failed');
  const profile = await getProfile();
  if (!profile || !isConfirmedPro(profile)) return finish('pro_required');
  if (req.cookies.get('youtube_oauth_user')?.value !== profile.id) return finish('connection_failed');
  try {
    const tokens = await exchangeYouTubeCode(youtubeConfig(), code);
    const encrypted = encryptRefreshToken(tokens.refreshToken, youtubeTokenKey());
    const { error } = await createAdminClient().from('youtube_connections').upsert({
      user_id: profile.id, refresh_token_enc: encrypted, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return finish('connected');
  } catch (error) {
    console.error('[youtube callback] connection failed', error instanceof Error ? error.message : error);
    return finish('connection_failed');
  }
}
