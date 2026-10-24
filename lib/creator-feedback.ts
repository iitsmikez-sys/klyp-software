import { CLIP_TYPES } from "./clips.ts";

export type CreatorFeedbackRow = {
  clip_type: string;
  verdict: string | null;
  edited_at?: string | null;
  downloaded_at?: string | null;
};

/** Aggregate only known labels; never forward user-controlled text into AI prompts. */
export function summarizeCreatorFeedback(rows: CreatorFeedbackRow[]): string {
  const known = new Set<string>(CLIP_TYPES);
  const scores = new Map<string, { value: number; count: number }>();
  let observations = 0;
  for (const row of rows.slice(0, 200)) {
    if (!known.has(row.clip_type)) continue;
    const signal = (row.verdict === "approved" ? 2 : row.verdict === "rejected" ? -2 : 0)
      + (row.edited_at ? 0.5 : 0) + (row.downloaded_at ? 1 : 0);
    if (!signal) continue;
    observations++;
    const prior = scores.get(row.clip_type) ?? { value: 0, count: 0 };
    scores.set(row.clip_type, { value: prior.value + signal, count: prior.count + 1 });
  }
  if (observations < 4) return "";
  const ranked = [...scores.entries()].filter(([, value]) => value.count >= 2)
    .sort((a, b) => b[1].value - a[1].value);
  const liked = ranked.filter(([, value]) => value.value >= 3).slice(0, 2).map(([type]) => type);
  const disliked = ranked.filter(([, value]) => value.value <= -3).slice(-2).map(([type]) => type);
  if (!liked.length && !disliked.length) return "";
  return [liked.length ? `Creator often keeps ${liked.join(", ")} moments.` : "",
    disliked.length ? `Creator often rejects ${disliked.join(", ")} moments.` : ""]
    .filter(Boolean).join(" ");
}
