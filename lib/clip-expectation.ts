/**
 * How the clip count is worded on screen. The requested number (10) is a ceiling, not a promise: Klyp only
 * returns moments worth posting, so a short video may give fewer. The wording names the ceiling without
 * guessing a smaller number from the video's length, and the request itself is never scaled by length either:
 * every analysis asks the finder for the top 10 (see tests/clip-expectation.test.mjs).
 */
export const bestMomentsText = (n: number) => `Best moments, up to ${n}`;
