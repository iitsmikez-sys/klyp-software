/**
 * Near-miss "extra" clips. The clip finder keeps its strict bar (65+) for the main list; Claude may also
 * also return the next-best moments that scored 25-64. They are added to the result, below the main picks,
 * only to fill the list towards the requested count (12 or 15), so a video is rarely left with 3 clips.
 *
 * Rules (each one has a test):
 *  - only scores from 40 up to (not including) the bar; nothing weaker is ever shown
 *  - with NO main pick ("best of this stream") the same rule applies, so a quiet or small
 *    streamer is not left empty-handed; the analysis is free then (see migration 043)
 *  - never more than the room left to the requested count
 *  - never overlapping, or starting within 30 seconds of, a main pick, an earlier extra, or a moment
 *    the user already received
 */
export const QUALITY_BAR = 65;
export const EXTRA_MIN_SCORE = 25;
/** The lowest score shown when nothing cleared the bar. */
export const BEST_OF_MIN_SCORE = 25;
export const MAX_EXTRAS = 10;
export const EXTRA_DEDUPE_WINDOW_S = 30;

type Window = { start_seconds: number; end_seconds: number };
type Scored = Window & { viral_score: number };

const collides = (a: Window, b: Window) =>
  Math.abs(a.start_seconds - b.start_seconds) < EXTRA_DEDUPE_WINDOW_S ||
  (a.start_seconds < b.end_seconds && a.end_seconds > b.start_seconds);

export function pickExtras<T extends Scored>(opts: {
  mainPicks: T[];
  candidates: T[];
  requestedCount: number;
  priorWindows?: Window[];
}): T[] {
  const { mainPicks, candidates, requestedCount, priorWindows = [] } = opts;
  const bestOf = mainPicks.length === 0;
  const room = Math.min(MAX_EXTRAS, requestedCount - mainPicks.length);
  if (room <= 0) return [];
  const floor = bestOf ? BEST_OF_MIN_SCORE : EXTRA_MIN_SCORE;
  const kept: T[] = [];
  const sorted = [...candidates]
    .filter((c) => Number.isFinite(c.viral_score) && c.viral_score >= floor && c.viral_score < QUALITY_BAR)
    .sort((a, b) => b.viral_score - a.viral_score);
  for (const clip of sorted) {
    if (kept.length >= room) break;
    if ([...priorWindows, ...mainPicks, ...kept].some((other) => collides(other, clip))) continue;
    kept.push(clip);
  }
  return kept;
}

/** True when every clip is below the quality bar: the results are "best of this stream", not top picks. */
export const isBestOfResult = (clips: { viral_score: number }[]) => clips.length > 0 && clips.every((c) => c.viral_score < QUALITY_BAR);

/** A top pick is a clip that cleared the quality bar; anything below it is an extra. */
export const isTopPick = (clip: { viral_score: number }) => clip.viral_score >= QUALITY_BAR;

/**
 * When the clip finder's answer is cut off by the output limit, the JSON stops in the middle of a clip and cannot be parsed.
 * The clips before the cut are complete, though, so this keeps them: it finds the "clips" array and returns the text of a
 * valid answer holding only the clips that were written out in full. Returns null when there is nothing to keep.
 */
export function salvageClipsJson(text: string): string | null {
  const key = text.indexOf('"clips"');
  if (key < 0) return null;
  const open = text.indexOf("[", key);
  if (open < 0) return null;

  const complete: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (depth === 0) objectStart = i; depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart >= 0) { complete.push(text.slice(objectStart, i + 1)); objectStart = -1; }
      if (depth < 0) break;
      continue;
    }
    if (ch === "]" && depth === 0) break; // the array ended normally
  }
  if (complete.length === 0) return null;
  const json = `{"clips":[${complete.join(",")}]}`;
  try { JSON.parse(json); } catch { return null; }
  return json;
}

/**
 * Chunked clip finding. One call over a whole long transcript sometimes stops after a clip or two (the same VOD gave 1 clip on one run
 * and 8 on the next). So a long video is read in windows of about 30 minutes, each asked for its own best moments, and the answers are
 * merged. Videos under CHUNK_MIN_SPAN_SECONDS are still read in one call, exactly as before.
 */
export const CHUNK_MIN_SPAN_SECONDS = 50 * 60;
export const CHUNK_SECONDS = 30 * 60;
/** Never more than this many calls for one video, however long (a longer video gets longer windows). */
export const MAX_CHUNKS = 6;
/** Windows overlap a little so a moment on a boundary is still seen whole by one of them. */
export const CHUNK_OVERLAP_SECONDS = 60;

export function planChunks(start: number, end: number): { start: number; end: number }[] {
  const span = end - start;
  if (!Number.isFinite(span) || span < CHUNK_MIN_SPAN_SECONDS) return [{ start, end }];
  const n = Math.min(MAX_CHUNKS, Math.ceil(span / CHUNK_SECONDS));
  const len = span / n;
  return Array.from({ length: n }, (_, i) => ({
    start: Math.max(start, Math.round(start + i * len - (i === 0 ? 0 : CHUNK_OVERLAP_SECONDS))),
    end: Math.min(end, Math.round(start + (i + 1) * len + (i === n - 1 ? 0 : CHUNK_OVERLAP_SECONDS))),
  }));
}

const ALLOWED_COUNTS = [1, 2, 3, 5, 7, 10, 12, 15, 20] as const;
/** How many moments each window is asked for: its share of the total plus some slack, at least 3, as an allowed clip count. */
export function perChunkCount(total: number, chunks: number): (typeof ALLOWED_COUNTS)[number] {
  const wanted = Math.max(3, Math.ceil(total / chunks) + 1);
  return ALLOWED_COUNTS.find((c) => c >= wanted) ?? 20;
}

/** Top picks first (best first), then near-misses (best first), moments that overlap or start within 30s of a better one dropped, cut to `total`. */
export function mergeChunkClips<T extends Scored>(perChunk: T[][], total: number): T[] {
  const all = perChunk.flat().filter((c) => Number.isFinite(c.viral_score));
  const ranked = [...all.filter((c) => c.viral_score >= QUALITY_BAR).sort((a, b) => b.viral_score - a.viral_score),
    ...all.filter((c) => c.viral_score < QUALITY_BAR).sort((a, b) => b.viral_score - a.viral_score)];
  const kept: T[] = [];
  for (const clip of ranked) {
    if (kept.length >= total) break;
    if (kept.some((other) => collides(other, clip))) continue;
    kept.push(clip);
  }
  return kept;
}
