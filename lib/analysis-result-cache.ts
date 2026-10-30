import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AudioWindow } from './twitch-chat';
import type { Clip, TimedWord } from './clips';
import { reviewClipBatch } from './clip-boundaries.ts';
import { clipInsideObservedCoverage } from './vod-candidates.ts';

export type ResultKeyInput = {
  sourceKey: string; durationSeconds: number; contentType: string; keyword: string;
  creatorPreferences: string; windows: AudioWindow[];
  priorWindows?: { start_seconds: number; end_seconds: number }[];
};
export function resultCacheKey(input: ResultKeyInput): string {
  return createHash('sha256').update(JSON.stringify({ version: 'v2', model: 'claude-opus-4-8',
    ...input, windows: [...input.windows].sort((a, b) => a.start - b.start) })).digest('hex');
}

/** Return only unsold, fully observed candidates; cached scores never bypass Opus. */
export function availableCachedClips<T extends { start_seconds: number; end_seconds: number }>(
  clips: T[], prior: { start_seconds: number; end_seconds: number }[], count: number,
  observed?: AudioWindow[],
): T[] {
  const result: T[] = [];
  for (const clip of clips) {
    if (observed && !clipInsideObservedCoverage(clip, observed)) continue;
    if ([...prior, ...result].some(other =>
      Math.abs(other.start_seconds - clip.start_seconds) < 60 ||
      (other.start_seconds < clip.end_seconds && other.end_seconds > clip.start_seconds))) continue;
    result.push(clip);
    if (result.length >= count) break;
  }
  return result;
}

/** Do not serve or charge an invalid cached cut; keep the raw judgment for adjustment. */
export function selectReviewedCachedClips(
  clips: Clip[], words: TimedWord[], vodSeconds: number,
  prior: { start_seconds: number; end_seconds: number }[], count: number,
  observed?: AudioWindow[],
) {
  const review = reviewClipBatch(clips, words, vodSeconds);
  return { clips: availableCachedClips(review.ready, prior, count, observed),
    flagged: review.flagged, readyCount: review.ready.length };
}
export function createResultCache(client: SupabaseClient, userId: string, sourceKey: string,
  durationSeconds: number, requestHash: string) {
  return {
    async load(): Promise<Clip[] | null> {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
      const { data, error } = await client.from('analysis_result_cache').select('vod_seconds,clips')
        .eq('user_id', userId).eq('source_key', sourceKey).eq('request_hash', requestHash)
        .gte('created_at', cutoff).maybeSingle();
      if (error) throw new Error(`Result cache unavailable: ${error.message}`);
      if (!data || Number(data.vod_seconds) !== durationSeconds || !Array.isArray(data.clips)) return null;
      return data.clips as Clip[];
    },
    async save(clips: Clip[]): Promise<void> {
      const { error } = await client.from('analysis_result_cache').upsert({
        user_id: userId, source_key: sourceKey, vod_seconds: durationSeconds,
        request_hash: requestHash, clips,
      }, { onConflict: 'user_id,source_key,request_hash', ignoreDuplicates: true });
      if (error) throw new Error(`Could not save judged candidates: ${error.message}`);
    },
  };
}
