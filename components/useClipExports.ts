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

export function useClipExports(onSparksSpent?: () => void) {
  const [exports, setExports] = useState<Record<string, ExportState>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);

  // Finished exports hold blobs in memory until the page goes away.
  const exportsRef = useRef(exports);
  exportsRef.current = exports;
  useEffect(() => () => {
    for (const state of Object.values(exportsRef.current)) {
      if (state.status === "ready") URL.revokeObjectURL(state.objectUrl);
    }
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
      try {
        const hasWords = Array.isArray(clip.words) && clip.words.length > 0;
        const res = await processingFetch("/api/clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Lets the server export from the archived 1080p master.
            clip_id: clip.id,
            url: clip.url,
            start_seconds: clip.start_seconds,
            end_seconds: clip.end_seconds,
            title: clip.title,
            style: hasWords ? "BOLD" : undefined,
            words: hasWords ? clip.words : undefined,
            handle: getStoredHandle(),
            aspect_ratio: "9:16",
            upscale: upscale || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Export failed (HTTP ${res.status}).`);
        }
        const blob = await res.blob();
        const state: ExportState = {
          status: "ready",
          objectUrl: URL.createObjectURL(blob),
          filename: exportFilename(clip.title, upscale ? "_4k" : ""),
        };
        setExports((prev) => ({ ...prev, [clip.id]: state }));
        // The click that asked for it is still the user's intent to save.
        downloadExport(state);
        if (upscale) onSparksSpent?.();
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed.";
        setExports((prev) => ({ ...prev, [clip.id]: { status: "error", error: message } }));
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

  return { exports, workingId, createClip, createOrDownload };
}
