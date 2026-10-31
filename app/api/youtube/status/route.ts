import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { canRetryUncertainPost, isConfirmedPro } from '@/lib/youtube-publishing';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!isConfirmedPro(profile)) return NextResponse.json({ proRequired: true, connected: false });
  const admin = createAdminClient();
  const { data: connection, error } = await admin.from('youtube_connections')
    .select('connected_at').eq('user_id', profile.id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not check YouTube connection.' }, { status: 500 });
  const clipId = new URL(req.url).searchParams.get('clip_id');
  if (clipId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clipId)) {
    return NextResponse.json({ error: 'Invalid clip ID.' }, { status: 400 });
  }
  let query = admin.from('youtube_posts')
    .select('id,clip_id,title,publish_at,youtube_video_id,status,error,created_at')
    .eq('user_id', profile.id);
  if (clipId) query = query.eq('clip_id', clipId);
  const { data: posts, error: postsError } = await query.order('created_at', { ascending: false }).limit(10);
  if (postsError) return NextResponse.json({ error: 'Could not check YouTube posts.' }, { status: 500 });
  return NextResponse.json({ connected: !!connection, proRequired: false,
    posts: (posts ?? []).map(post => ({ ...post, canRetry: canRetryUncertainPost(post) })) });
}
