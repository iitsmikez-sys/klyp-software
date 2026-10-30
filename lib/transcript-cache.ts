import type { SupabaseClient } from '@supabase/supabase-js';
import { validCoverageSegment, type CoverageSegment } from './transcript-coverage';

export const ANALYSIS_CACHE_VERSION = 'v2';
export const ANALYSIS_SPEECH_MODEL = 'best';

/** RLS-scoped cache. Only complete, versioned VOD intervals may be reused. */
export function createTranscriptCache(
  client: SupabaseClient,
  userId: string,
  sourceKey: string,
  vodSeconds: number,
) {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  return {
    async load(): Promise<CoverageSegment[]> {
      const segments: CoverageSegment[] = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data, error } = await client.from('analysis_transcript_cache')
          .select('start_seconds,end_seconds,actual_audio_seconds,vod_seconds,version,model,words')
          .eq('user_id', userId).eq('source_key', sourceKey)
          .eq('version', ANALYSIS_CACHE_VERSION).eq('model', ANALYSIS_SPEECH_MODEL)
          .gte('created_at', cutoff).order('start_seconds')
          .range(offset, offset + 999);
        if (error) throw new Error(`Transcript cache unavailable: ${error.message}`);
        for (const row of data ?? []) {
          const segment: CoverageSegment = {
            start: Number(row.start_seconds), end: Number(row.end_seconds),
            actualAudioSeconds: Number(row.actual_audio_seconds), vodSeconds: Number(row.vod_seconds),
            version: String(row.version), model: String(row.model), words: row.words,
          };
          if (validCoverageSegment(segment, vodSeconds, ANALYSIS_CACHE_VERSION, ANALYSIS_SPEECH_MODEL)) segments.push(segment);
        }
        if ((data?.length ?? 0) < 1000) return segments;
      }
      throw new Error('Transcript cache has too many segments to verify safely');
    },
    async save(segment: CoverageSegment): Promise<void> {
      if (!validCoverageSegment(segment, vodSeconds, ANALYSIS_CACHE_VERSION, ANALYSIS_SPEECH_MODEL)) {
        throw new Error('Refusing to save transcript with incomplete or mismatched VOD coverage');
      }
      const { error } = await client.from('analysis_transcript_cache').upsert({
        user_id: userId, source_key: sourceKey, vod_seconds: vodSeconds,
        version: segment.version, model: segment.model,
        start_seconds: segment.start, end_seconds: segment.end,
        actual_audio_seconds: segment.actualAudioSeconds, words: segment.words,
      }, { onConflict: 'user_id,source_key,version,model,start_seconds,end_seconds', ignoreDuplicates: true });
      if (error) throw new Error(`Could not save transcript coverage: ${error.message}`);
    },
  };
}
export type TranscriptCache = ReturnType<typeof createTranscriptCache>;
