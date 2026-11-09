/**
 * A library row is only a confirmed save after its private media archive is stored.
 * The wording stays honest (a clip that is not backed up says so) but calm: "failed" and "not protected" read as an alarm.
 * Only footage that is truly gone is worth a warning colour (see backupTone).
 */
export const backupTone = (kind: ReturnType<typeof backupState>["kind"]): "good" | "quiet" | "warn" =>
  kind === "saved" ? "good" : kind === "unavailable" ? "warn" : "quiet";

export function backupState(status: string | null | undefined, source?: string): {
  kind: "saved" | "backing_up" | "failed" | "unavailable" | "unconfirmed";
  message: string;
} {
  switch (status) {
    case "stored": return { kind: "saved", message: "Saved · backup ready" };
    case "pending":
    case "processing": return { kind: "backing_up", message: "Saving your clip…" };
    case "failed": return { kind: "failed", message: "Not backed up yet" };
    case "unavailable": return { kind: "unavailable", message: source?.startsWith('upload:')
      ? "Upload lost before backup · reupload VOD" : "Footage unavailable · backup not saved" };
    case "expired": return { kind: "unavailable", message: "Saved copy expired · footage unavailable" };
    default: return { kind: "unconfirmed", message: "Backup not confirmed" };
  }
}
