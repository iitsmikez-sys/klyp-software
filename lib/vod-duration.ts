/** Refuse a truncated source before treating its tail as unobserved silence. */
export function verifyVodDuration(expectedSeconds: number, observedSeconds: number): number {
  if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0 ||
      !Number.isFinite(observedSeconds) || observedSeconds <= 0) {
    throw new Error('Could not verify VOD duration');
  }
  const tolerance = Math.max(30, expectedSeconds * 0.01);
  if (observedSeconds + tolerance < expectedSeconds) {
    throw new Error(`Downloaded VOD audio is incomplete (${Math.round(observedSeconds)}s of expected ${Math.round(expectedSeconds)}s); refusing partial analysis`);
  }
  return Math.round(observedSeconds);
}
