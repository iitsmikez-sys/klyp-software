/** A library row is only a confirmed save after its private media archive is stored. */
export function backupState(status: string | null | undefined, source?: string): {
  kind: "saved" | "backing_up" | "failed" | "unavailable" | "unconfirmed";
  message: string;
} {
  switch (status) {
    case "stored": return { kind: "saved", message: "Saved · backup ready" };
    case "pending":
    case "processing": return { kind: "backing_up", message: "Backing up · not saved yet" };
    case "failed": return { kind: "failed", message: "Backup failed · clip not protected" };
    case "unavailable": return { kind: "unavailable", message: source?.startsWith('upload:')
      ? "Upload lost before backup · reupload VOD" : "Footage unavailable · backup not saved" };
    default: return { kind: "unconfirmed", message: "Backup not confirmed" };
  }
}
