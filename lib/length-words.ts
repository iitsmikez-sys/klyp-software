/** A length in plain words for people to read: "2 hours 54 minutes", "1 hour", "45 minutes". */
export function lengthWords(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const h = hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "";
  const m = minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "";
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}
