"use client";
import { userFacingClipError } from '@/lib/analyze-errors';

import { useEffect, useRef, useState } from "react";
import { processingFetch } from "@/lib/processing-api";
import { downloadExport, exportFilename, type ExportState } from "@/lib/clip-export";
import type { SavedClip } from "@/lib/clip-ui";
import { readyClipRequest } from "@/lib/ready-clip";
import { getStoredHandle } from "@/lib/streamer-handle";

export type RawDownloadState = Exclude<ExportState, { status: "working" }> | { status: "working"; seconds: number; received?: number };

/**
 * Raw moment downloads never share the edited export cache or its billing path. The same hook also
 * renders the finished "ready clip" (lib/ready-clip.ts), kept in its own state so the two never mix.
 */
export function useRawClipDownloads() {
  const [rawStates, setRawStates] = useState<Record<string, RawDownloadState>>({});
  const [readyStates, setReadyStates] = useState<Record<string, RawDownloadState>>({});
  const rawCache = useRef<Record<string, string>>({});
  const readyCache = useRef<Record<string, string>>({});
  const busy = useRef(new Set<string>());
  useEffect(() => () => { Object.values(rawCache.current).forEach(URL.revokeObjectURL); Object.values(readyCache.current).forEach(URL.revokeObjectURL); }, []);

  const download = async (clip: SavedClip, kind: "raw" | "ready") => {
    const states = kind === "ready" ? readyStates : rawStates;
    const setStates = kind === "ready" ? setReadyStates : setRawStates;
    const cache = kind === "ready" ? readyCache : rawCache;
    const prior = states[clip.id];
    if (prior?.status === "ready") { downloadExport(prior, clip.id); return; }
    const busyKey = kind + ":" + clip.id;
    if (busy.current.has(busyKey)) return;
    busy.current.add(busyKey);
    const started = Date.now();
    setStates(s => ({ ...s, [clip.id]: { status: "working", seconds: 0 } }));
    const ticker = window.setInterval(() => setStates(s => ({ ...s, [clip.id]: { status: "working", seconds: Math.floor((Date.now() - started) / 1000) } })), 1000);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60_000);
    try {
      const response = await processingFetch("/api/clip", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "ready"
          ? readyClipRequest(clip, { url: clip.url, clipId: clip.id, handle: getStoredHandle() })
          : { clip_id: clip.id, raw: true }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(userFacingClipError(body?.error ?? `${kind === "ready" ? "Download" : "Raw download"} failed (HTTP ${response.status}).`));
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
      const ready: ExportState = { status: "ready", objectUrl, filename: exportFilename(clip.title, kind === "ready" ? "" : "_raw") };
      setStates(s => ({ ...s, [clip.id]: ready }));
      downloadExport(ready, clip.id);
    } catch (error) {
      setStates(s => ({ ...s, [clip.id]: { status: "error", error: controller.signal.aborted ? "Download timed out. Try again." : error instanceof Error ? userFacingClipError(error.message) : "Download failed. Try again." } }));
    } finally {
      window.clearInterval(ticker);
      window.clearTimeout(timeout);
      busy.current.delete(busyKey);
    }
  };
  return {
    rawDownloads: rawStates, downloadRaw: (clip: SavedClip) => download(clip, "raw"),
    readyDownloads: readyStates, downloadReady: (clip: SavedClip) => download(clip, "ready"),
  };
}
