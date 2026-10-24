/**
 * Export state for a saved clip, held by the My Clips page rather than by the
 * card or the preview dialog — closing the dialog mid-render must not cancel
 * the export or lose the finished file.
 *
 * A finished export is kept as an object URL so the button can flip from
 * "Create clip" to "Download clip" and hand over the same file again without
 * re-rendering it on the server.
 */
import { createClient } from "@/lib/supabase/client";

export type ExportState =
  | { status: "working" }
  | { status: "ready"; objectUrl: string; filename: string; warning?: string | null }
  | { status: "error"; error: string };

export function readyExportWarning(state: ExportState | undefined): string | null {
  return state?.status === "ready" ? state.warning ?? null : null;
}

/** Filesystem-safe name derived from the clip title. */
export function exportFilename(title: string, suffix = ""): string {
  const safe = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
  return `${safe || "klyp_clip"}${suffix}.mp4`;
}

/** Trigger a browser download for an already-rendered export. */
export function downloadExport(state: ExportState, clipId?: string): void {
  if (state.status !== "ready") return;
  const a = document.createElement("a");
  a.href = state.objectUrl;
  a.download = state.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (clipId) void createClient().rpc("record_clip_feedback", { p_clip_id: clipId, p_signal: "downloaded" });
}
