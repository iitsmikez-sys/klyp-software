import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { revokeYouTubeToken } from '@/lib/youtube-api';
import { youtubeTokenKey } from '@/lib/youtube-config';
import { decryptRefreshToken } from '@/lib/youtube-publishing';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const admin = createAdminClient();
  const { data: connection, error: lookupError } = await admin.from('youtube_connections')
    .select('refresh_token_enc').eq('user_id', profile.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: 'Could not check YouTube connection.' }, { status: 500 });
  if (!connection) return NextResponse.json({ connected: false });
  try {
    await revokeYouTubeToken(decryptRefreshToken(connection.refresh_token_enc, youtubeTokenKey()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not revoke YouTube access.' }, { status: 502 });
  }
  const { error } = await admin.from('youtube_connections').delete().eq('user_id', profile.id);
  if (error) return NextResponse.json({ error: 'Could not disconnect YouTube.' }, { status: 500 });
  return NextResponse.json({ connected: false });
}
