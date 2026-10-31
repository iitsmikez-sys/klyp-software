import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { bearerToken, getProfileFromToken } from '@/lib/profile-token';
import { acquireUserProcessingSlot } from '@/lib/clip-access';
import { parseFrameSuggestion, readBoundedFrameBody, validateFrameSamples } from '@/lib/auto-frame';
import { withCors, corsPreflight } from '@/lib/cors';
import { hasProAccess } from '@/lib/tier';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const OPTIONS = corsPreflight;

const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const suggestion = z.object({ confidence: z.number(), gameplay: rect, facecam: rect.nullable() });
const recent = globalThis as typeof globalThis & { __klypAutoFrameRecent?: Map<string, number> };
const requests = recent.__klypAutoFrameRecent ??= new Map<string, number>();

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withCors(await handle(req, context));
}

async function handle(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== 'processing') return NextResponse.json({ error: 'Processing service only.' }, { status: 404 });
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'Sign in to suggest a frame.' }, { status: 401 });
  let profile;
  try { profile = await getProfileFromToken(token); } catch { return NextResponse.json({ error: 'Could not check your account.' }, { status: 500 }); }
  if (!profile) return NextResponse.json({ error: 'Sign in to suggest a frame.' }, { status: 401 });
  if (!hasProAccess(profile)) return NextResponse.json({ error: 'Framing suggestions require Pro access.' }, { status: 403 });
  const { id } = await context.params;
  const { data: clip, error: clipError } = await createAdminClient().from('clips').select('id').eq('id', id).eq('user_id', profile.id).maybeSingle();
  if (clipError) return NextResponse.json({ error: 'Could not check this clip.' }, { status: 500 });
  if (!clip) return NextResponse.json({ error: 'Clip not found.' }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Frame suggestions are temporarily unavailable.' }, { status: 503 });

  let frames: Buffer[];
  try { frames = validateFrameSamples((await readBoundedFrameBody(req) as { frames?: unknown }).frames); }
  catch { return NextResponse.json({ error: 'Send up to three small JPEG frames.' }, { status: 400 }); }
  const key = profile.id;
  if (Date.now() - (requests.get(key) ?? 0) < 60_000) return NextResponse.json({ error: 'Wait a minute before asking for another suggestion.' }, { status: 429 });
  const release = acquireUserProcessingSlot(profile.id);
  if (!release) return NextResponse.json({ error: 'Too many clip requests are processing.' }, { status: 429 });
  requests.set(key, Date.now());
  try {
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {});
    const response = await client.messages.create({
      model: process.env.KLYP_VISION_MODEL || 'claude-sonnet-4-6',
      max_tokens: 250,
      messages: [{ role: 'user', content: [
        ...frames.map(frame => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: frame.toString('base64') } })),
        { type: 'text', text: 'These are sampled frames from one livestream clip. Suggest ONE stable 9:16 framing for all frames. Return normalized 0–1 source rectangles. gameplay is the main region: center the consistent person for IRL or the important action for gaming. If a separate small webcam is clearly present in a consistent corner, set facecam to its rectangle; otherwise null. Do not guess a facecam from game characters. Confidence 0–1 reflects stability across samples; use below 0.72 if uncertain. Return only the required JSON.' },
      ] }],
      output_config: { format: zodOutputFormat(suggestion) },
    }, { timeout: 30_000, maxRetries: 0 });
    const text = response.content.find(block => block.type === 'text')?.text;
    const parsed = text ? suggestion.parse(JSON.parse(text)) : null;
    const layout = parseFrameSuggestion(parsed);
    return NextResponse.json({ layout, message: layout ? 'Review the suggested crop, then save your edit.' : 'No stable subject was found. Your framing was left unchanged.' });
  } catch {
    requests.delete(key);
    return NextResponse.json({ error: 'Could not suggest a frame right now. Your crop is unchanged.' }, { status: 502 });
  } finally { release(); }
}
