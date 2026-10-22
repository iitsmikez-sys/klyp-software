"use client";

/**
 * Shared clip-export state for any page that lists clips (My Clips, the
 * dashboard's Saved Clips). Held above the cards and the preview dialog so
 * closing the dialog mid-render neither cancels the export nor loses the file,
 * and a finished export flips every view of that clip to "Download clip".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { processingFetch } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";
import { type ExportState, exportFilename, downloadExport } from "@/lib/clip-export";
import type { SavedClip } from "@/lib/clip-ui";
import { readClipEditDraft, toClipExportPayload } from "@/lib/clip-edit-draft";

export function useClipExports(onSparksSpent?: () => void) {
  const [exports, setExports] = useState<Record<string, ExportState>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  // Finished exports hold blobs in memory until the page goes away.
  const exportsRef = useRef(exports);
  const revisionRef = useRef<Record<string, number>>({});
  exportsRef.current = exports;
  useEffect(() => () => {
    for (const state of Object.values(exportsRef.current)) {
      if (state.status === "ready") URL.revokeObjectURL(state.objectUrl);
    }
  }, []);

  const invalidateClip = useCallback((id: string) => {
    revisionRef.current[id] = (revisionRef.current[id] ?? 0) + 1;
    const existing = exportsRef.current[id];
    if (existing?.status === "ready") URL.revokeObjectURL(existing.objectUrl);
    const next = { ...exportsRef.current };
    delete next[id];
    exportsRef.current = next;
    setExports(next);
  }, []);

  /**
   * Render a clip's MP4 and keep it. Only ever called from an explicit
   * "Create clip" — opening a preview must not start an export.
   */
  const createClip = useCallback(
    async (clip: SavedClip, upscale = false) => {
      if (workingId) return;
      setWorkingId(clip.id);
      setExports((prev) => ({ ...prev, [clip.id]: { status: "working" } }));
      const revision = revisionRef.current[clip.id] ?? 0;
      try {
        const draft = readClipEditDraft(clip).draft;
        const res = await processingFetch("/api/clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...toClipExportPayload(clip, draft),
            handle: getStoredHandle(),
            upscale: upscale || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Export failed (HTTP ${res.status}).`);
        }
        const blob = await res.blob();
        if ((revisionRef.current[clip.id] ?? 0) !== revision) return null;
        const state: ExportState = {
          status: "ready",
          objectUrl: URL.createObjectURL(blob),
          filename: exportFilename(draft.title, upscale ? "_4k" : ""),
        };
        setExports((prev) => ({ ...prev, [clip.id]: state }));
        // The click that asked for it is still the user's intent to save.
        downloadExport(state);
        if (upscale) onSparksSpent?.();
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed.";
        if ((revisionRef.current[clip.id] ?? 0) === revision) {
          setExports((prev) => ({ ...prev, [clip.id]: { status: "error", error: message } }));
        }
        return message;
      } finally {
        setWorkingId(null);
      }
    },
    [workingId, onSparksSpent]
  );

  /** Create on first click, re-save the rendered file on later ones. */
  const createOrDownload = useCallback(
    (clip: SavedClip) => {
      const done = exportsRef.current[clip.id];
      if (done?.status === "ready") {
        downloadExport(done);
        return Promise.resolve(null);
      }
      return createClip(clip);
    },
    [createClip]
  );

  return { exports, workingId, createClip, createOrDownload, invalidateClip };
}
