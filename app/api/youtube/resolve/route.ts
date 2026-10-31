import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { canRetryUncertainPost, isConfirmedPro } from '@/lib/youtube-publishing';

export const runtime = 'nodejs';

/** Explicit recovery after a lost/uncertain upload; never auto-retry a possible post. */
export async function POST(req: NextRequest): Promise<Response> {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!isConfirmedPro(profile)) return NextResponse.json({ error: 'YouTube publishing requires Pro.' }, { status: 403 });
  let id: string;
  try {
    const body = await req.json();
    id = String(body.id ?? '');
    if (!body.confirmNoUpload || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Check your YouTube channel and confirm before retrying.');
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: post, error } = await admin.from('youtube_posts')
    .select('id,status,youtube_video_id,created_at').eq('id', id).eq('user_id', profile.id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not check this post.' }, { status: 500 });
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 });
  if (!canRetryUncertainPost(post)) {
    return NextResponse.json({ error: 'This post is still processing or has a confirmed YouTube video. Check your channel before retrying.' }, { status: 409 });
  }
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: updated, error: updateError } = await admin.from('youtube_posts')
    .update({ status: 'failed', error: 'User confirmed no video on YouTube before retrying.', updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', profile.id).in('status', ['processing', 'needs_review'])
    .is('youtube_video_id', null).lte('created_at', cutoff).select('id').maybeSingle();
  if (updateError) return NextResponse.json({ error: 'Could not clear this post for a retry.' }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Post changed while you reviewed it. Refresh and check again.' }, { status: 409 });
  return NextResponse.json({ readyToRetry: true });
}
