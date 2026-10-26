"use client";

import { useEffect, useRef, useState } from "react";
import { processingFetch } from "@/lib/processing-api";
import { downloadExport, exportFilename, type ExportState } from "@/lib/clip-export";
import type { SavedClip } from "@/lib/clip-ui";

export type RawDownloadState = Exclude<ExportState, { status: "working" }> | { status: "working"; seconds: number; received?: number };

/** Raw moment downloads never share the edited export cache or its billing path. */
export function useRawClipDownloads() {
  const [states, setStates] = useState<Record<string, RawDownloadState>>({});
  const cache = useRef<Record<string, string>>({});
  const busy = useRef(new Set<string>());
  useEffect(() => () => { Object.values(cache.current).forEach(URL.revokeObjectURL); }, []);

  const downloadRaw = async (clip: SavedClip) => {
    const prior = states[clip.id];
    if (prior?.status === "ready") { downloadExport(prior, clip.id); return; }
    if (busy.current.has(clip.id)) return;
    busy.current.add(clip.id);
    const started = Date.now();
    setStates(s => ({ ...s, [clip.id]: { status: "working", seconds: 0 } }));
    const ticker = window.setInterval(() => setStates(s => ({ ...s, [clip.id]: { status: "working", seconds: Math.floor((Date.now() - started) / 1000) } })), 1000);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60_000);
    try {
      const response = await processingFetch("/api/clip", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_id: clip.id, raw: true }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Raw download failed (HTTP ${response.status}).`);
      }
      const total = Number(response.headers.get("Content-Length")) || 0;
      let blob: Blob;
      if (response.body && total) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          setStates(s => ({ ...s, [clip.id]: { status: "working", seconds: Math.floor((Date.now() - started) / 1000), received: Math.min(99, Math.round(100 * received / total)) } }));
        }
        blob = new Blob(chunks as BlobPart[], { type: "video/mp4" });
      } else blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (cache.current[clip.id]) URL.revokeObjectURL(cache.current[clip.id]);
      cache.current[clip.id] = objectUrl;
      const ready: ExportState = { status: "ready", objectUrl, filename: exportFilename(clip.title, "_raw") };
      setStates(s => ({ ...s, [clip.id]: ready }));
      downloadExport(ready, clip.id);
    } catch (error) {
      setStates(s => ({ ...s, [clip.id]: { status: "error", error: controller.signal.aborted ? "Raw download timed out. Try again." : error instanceof Error ? error.message : "Raw download failed. Try again." } }));
    } finally {
      window.clearInterval(ticker);
      window.clearTimeout(timeout);
      busy.current.delete(clip.id);
    }
  };
  return { rawDownloads: states, downloadRaw };
}
