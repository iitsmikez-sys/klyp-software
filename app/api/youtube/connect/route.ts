import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import { isConfirmedPro } from '@/lib/youtube-publishing';
import { youtubeConsentUrl } from '@/lib/youtube-api';
import { youtubeConfig } from '@/lib/youtube-config';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const profile = await getProfile();
  if (!profile) return NextResponse.redirect(new URL('/login', req.url));
  if (!isConfirmedPro(profile)) return NextResponse.redirect(new URL('/dashboard/upgrade', req.url));
  const clipId = new URL(req.url).searchParams.get('clip_id') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clipId)) {
    return NextResponse.json({ error: 'Choose a saved clip before connecting YouTube.' }, { status: 400 });
  }
  try {
    const state = randomBytes(24).toString('hex');
    const redirect = NextResponse.redirect(youtubeConsentUrl(youtubeConfig(), state));
    const cookie = { httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'lax' as const,
      maxAge: 600, path: '/' };
    redirect.cookies.set('youtube_oauth_state', state, cookie);
    redirect.cookies.set('youtube_oauth_clip', clipId, cookie);
    redirect.cookies.set('youtube_oauth_user', profile.id, cookie);
    return redirect;
  } catch {
    return NextResponse.json({ error: 'YouTube connection is not configured yet.' }, { status: 503 });
  }
}
