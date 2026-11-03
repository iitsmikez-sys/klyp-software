/**
 * Near-miss "extra" clips. The clip finder keeps its strict bar (65+) for the main list; Claude may also
 * return up to 3 moments that scored 55-64. They are added to the result, below the main picks, only
 * to fill the list towards the requested count.
 *
 * Rules (each one has a test):
 *  - only when at least one main pick cleared the bar (a video with no good moment gets no extras, so
 *    the "nothing found, pay half" rule keeps working)
 *  - only scores from 55 up to (not including) the bar
 *  - at most 3, and never more than the room left to the requested count
 *  - never overlapping, or starting within 60 seconds of, a main pick, an earlier extra, or a moment
 *    the user already received
 */
export const QUALITY_BAR = 65;
export const EXTRA_MIN_SCORE = 55;
export const MAX_EXTRAS = 3;
export const EXTRA_DEDUPE_WINDOW_S = 60;

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
  if (mainPicks.length === 0) return [];
  const room = Math.min(MAX_EXTRAS, requestedCount - mainPicks.length);
  if (room <= 0) return [];
  const kept: T[] = [];
  const sorted = [...candidates]
    .filter((c) => Number.isFinite(c.viral_score) && c.viral_score >= EXTRA_MIN_SCORE && c.viral_score < QUALITY_BAR)
    .sort((a, b) => b.viral_score - a.viral_score);
  for (const clip of sorted) {
    if (kept.length >= room) break;
    if ([...priorWindows, ...mainPicks, ...kept].some((other) => collides(other, clip))) continue;
    kept.push(clip);
  }
  return kept;
}

/** A top pick is a clip that cleared the quality bar; anything below it is an extra. */
export const isTopPick = (clip: { viral_score: number }) => clip.viral_score >= QUALITY_BAR;
