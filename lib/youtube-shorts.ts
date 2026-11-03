/**
 * YouTube decides what is a Short on its own: a vertical or square video up to three minutes long. There is
 * no Short flag in the upload API, so Klyp checks the clip before upload, tells the person what they will
 * get, and adds #Shorts to the description of a vertical clip, which YouTube uses as a hint.
 */
export const SHORTS_TAG = "#Shorts";
export const SHORTS_MAX_SECONDS = 180;

export type ShortsStatus = { isShort: boolean; reason: "ok" | "not_vertical" | "too_long" };

export function shortsStatus(payload: Record<string, unknown> | null | undefined): ShortsStatus {
  if (!payload) return { isShort: false, reason: "not_vertical" };
  const aspect = payload.aspect_ratio;
  if (aspect !== "9:16" && aspect !== "1:1") return { isShort: false, reason: "not_vertical" };
  const start = payload.start_seconds, end = payload.end_seconds;
  if (typeof start === "number" && typeof end === "number" && end - start > SHORTS_MAX_SECONDS) return { isShort: false, reason: "too_long" };
  return { isShort: true, reason: "ok" };
}

/** Add #Shorts to the description once, on its own line. */
export function withShortsTag(description: string): string {
  if (/#shorts\b/i.test(description)) return description;
  const trimmed = description.trim();
  return trimmed ? `${trimmed}\n\n${SHORTS_TAG}` : SHORTS_TAG;
}
