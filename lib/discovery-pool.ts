/** The delivery count must never narrow the search for strong moments. */
export function discoveryPoolSize(requested: number): 10 | 20 {
  return requested > 10 ? 20 : 10;
}

/** One continuous window keeps context and payoffs visible at hour boundaries. */
export function fullVodCoverage(seconds: number): { start: number; end: number }[] {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid VOD duration');
  return [{ start: 0, end: seconds }];
}
