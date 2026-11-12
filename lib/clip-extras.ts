/**
 * Near-miss "extra" clips. The clip finder keeps its strict bar (65+) for the main list; Claude may also
 * also return the next-best moments that scored 40-64. They are added to the result, below the main picks,
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
export const EXTRA_MIN_SCORE = 40;
/** The lowest score shown when nothing cleared the bar. */
export const BEST_OF_MIN_SCORE = 40;
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
