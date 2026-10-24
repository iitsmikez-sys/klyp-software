export type VisualCandidate = { start_seconds: number; end_seconds: number; viral_score: number; reason: string };

/** Cost ceiling: inspect one middle frame for each of the two strongest moments. */
export function planVisualChecks<T extends VisualCandidate>(clips: T[]) {
  return clips.slice(0, 2).map((clip, index) => ({
    clip, index, frameSecond: Math.round((clip.start_seconds + clip.end_seconds) / 2),
  }));
}

export function applyVisualCheck<T extends VisualCandidate>(clip: T, rawAdjustment: number): T {
  if (clip.viral_score < 65) return clip;
  const adjustment = Math.max(-4, Math.min(4, Math.round(rawAdjustment)));
  return { ...clip, viral_score: Math.max(65, Math.min(100, clip.viral_score + adjustment)) };
}
