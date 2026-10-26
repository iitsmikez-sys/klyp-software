"use client";

import Link from "next/link";
import { useState } from "react";
import ClipThumbnail from "./ClipThumbnail";
import type { RawDownloadState } from "./useRawClipDownloads";
import { type SavedClip, fmtTime, platformName, footageGone, vodLinkAt } from "@/lib/clip-ui";

export default function CompactClipCard({ clip, onPreview, onDownloadRaw, rawState, more }: {
  clip: SavedClip;
  onPreview: () => void;
  onDownloadRaw: () => void;
  rawState?: RawDownloadState;
  more?: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const gone = footageGone(clip);
  const rawLabel = rawState?.status === "working"
    ? rawState.received !== undefined ? `Downloading ${rawState.received}%` : `Preparing raw ${rawState.seconds}s`
    : rawState?.status === "ready" ? "Download Raw Again" : "Download Raw";
  return <article className="min-w-0 rounded-xl border border-border bg-surface p-3 flex flex-col">
    <ClipThumbnail clip={clip} onPlay={onPreview} />
    <div className="mt-3 flex items-start justify-between gap-2">
      <h3 className="min-w-0 line-clamp-2 text-base font-semibold text-foreground">{clip.title}</h3>
      {more ?? <div className="relative shrink-0">
        <button type="button" aria-label={`More actions for ${clip.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className="rounded-md border border-border px-2 py-0.5 text-foreground-muted hover:text-foreground">•••</button>
        {menuOpen && <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-border bg-surface p-1 shadow-xl">
          <button type="button" onClick={() => { setMenuOpen(false); onPreview(); }} className="block w-full rounded px-3 py-2 text-left text-xs text-foreground-muted hover:bg-surface-2">Preview</button>
          {!clip.url.startsWith("upload:") && <a href={vodLinkAt(clip.url, clip.start_seconds)} target="_blank" rel="noopener noreferrer" className="block rounded px-3 py-2 text-xs text-foreground-muted hover:bg-surface-2">Watch Original</a>}
        </div>}
      </div>}
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-muted">
      <span>{clip.url.startsWith("upload:") ? "Uploaded VOD" : platformName(clip.url)}</span><span aria-hidden="true">·</span>
      <span>VOD {fmtTime(clip.start_seconds)}</span>
      {clip.clip_type && <><span aria-hidden="true">·</span><span>{clip.clip_type.replaceAll("_", " ")}</span></>}
    </div>
    <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
      <Link href={`/dashboard/clips/${clip.id}/edit`} className="flex min-h-10 items-center justify-center rounded-lg bg-accent px-3 text-center text-sm font-semibold text-background hover:bg-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Edit Clip</Link>
      <button type="button" onClick={onDownloadRaw} disabled={gone || rawState?.status === "working"} title={gone ? "Source footage is unavailable" : undefined} className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">{gone ? "Footage unavailable" : rawLabel}</button>
    </div>
    {rawState?.status === "working" && <p role="status" className="mt-2 text-xs text-foreground-muted">Extracting original video and audio. No Sparks charged.</p>}
    {rawState?.status === "error" && <p role="alert" className="mt-2 text-xs text-red-400">{rawState.error} <button type="button" onClick={onDownloadRaw} className="underline">Retry</button></p>}
  </article>;
}
