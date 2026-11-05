"use client";

import Link from "next/link";
import { useState } from "react";
import ClipThumbnail from "./ClipThumbnail";
import ScoreBadge from "./ScoreBadge";
import type { RawDownloadState } from "./useRawClipDownloads";
import { type SavedClip, fmtTime, platformName, footageGone, vodLinkAt } from "@/lib/clip-ui";
import { backupState } from "@/lib/clip-backup-state";
import { isMediaExpired } from "@/lib/clip-expiry";

export default function CompactClipCard({ clip, onPreview, onDownloadRaw, rawState, onDownloadReady, readyState, more, compact = false }: {
  clip: SavedClip;
  onPreview: () => void;
  onDownloadRaw: () => void;
  rawState?: RawDownloadState;
  onDownloadReady?: () => void;
  readyState?: RawDownloadState;
  more?: React.ReactNode;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const gone = footageGone(clip);
  const backup = backupState(isMediaExpired(clip) ? "expired" : clip.archive_status, clip.url);
  const rawLabel = rawState?.status === "working"
    ? rawState.received !== undefined ? `Downloading ${rawState.received}%` : `Preparing raw ${rawState.seconds}s`
    : rawState?.status === "ready" ? "Download Raw Again" : "Download Raw";
  const readyLabel = readyState?.status === "working"
    ? readyState.received !== undefined ? `Downloading ${readyState.received}%` : `Preparing ${readyState.seconds}s`
    : readyState?.status === "ready" ? "Download ready clip again" : "Download ready clip";
  return <article className={`group flex min-w-0 flex-col rounded-xl border border-border bg-surface transition-colors hover:border-subtle ${compact ? "p-2.5" : "p-3"}`}>
    <div className="relative">
      <ClipThumbnail clip={clip} onPlay={onPreview} />
      <ScoreBadge score={clip.viral_score} />
    </div>
    <div className={`${compact ? "mt-2" : "mt-3"} flex items-start justify-between gap-2`}>
      <h3 className={`min-w-0 line-clamp-2 font-semibold text-foreground ${compact ? "text-sm leading-snug" : "text-base"}`}>{clip.title}</h3>
      {more ?? <div className="relative shrink-0">
        <button type="button" aria-label={`More actions for ${clip.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className="rounded-md border border-border px-2 py-0.5 text-foreground-muted hover:text-foreground">•••</button>
        {menuOpen && <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-border bg-surface p-1 shadow-xl">
          <button type="button" onClick={() => { setMenuOpen(false); onPreview(); }} className="block w-full rounded px-3 py-2 text-left text-xs text-foreground-muted hover:bg-surface-2">Preview</button>
          {!clip.url.startsWith("upload:") && <a href={vodLinkAt(clip.url, clip.start_seconds)} target="_blank" rel="noopener noreferrer" className="block rounded px-3 py-2 text-xs text-foreground-muted hover:bg-surface-2">Watch Original</a>}
        </div>}
      </div>}
    </div>
    <div className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-foreground-muted ${compact ? "text-[11px]" : "text-xs"}`}>
      <span>{clip.url.startsWith("upload:") ? "Uploaded VOD" : platformName(clip.url)}</span><span aria-hidden="true">·</span>
      <span>{fmtTime(clip.start_seconds)} in VOD</span>
      {clip.clip_type && <><span aria-hidden="true">·</span><span>{clip.clip_type.replaceAll("_", " ")}</span></>}
    </div>
    <p role="status" className={`mt-2 text-xs ${backup.kind === 'saved' ? 'text-accent' : 'text-amber-300'}`}>{backup.message}</p>
    {clip.archive_status === 'stored' && clip.media_expires_at && !gone &&
      <p className="mt-1 text-xs text-foreground-muted">Saved until {new Date(clip.media_expires_at).toLocaleDateString()}</p>}
    <div className={`mt-auto ${compact ? "pt-3" : "pt-4"}`}>
      <button type="button" onClick={onDownloadReady} disabled={gone || !onDownloadReady || readyState?.status === "working"} title={gone ? "Source footage is unavailable" : undefined} className={`w-full rounded-lg bg-accent px-2 font-semibold text-background transition-colors hover:bg-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${compact ? "min-h-9 text-xs" : "min-h-10 text-sm"}`}>{gone ? "Footage unavailable" : readyLabel}</button>
      <div className="mt-2 grid grid-cols-2 gap-2">
      <Link href={`/dashboard/clips/${clip.id}/edit`} className={`flex items-center justify-center rounded-lg border border-border px-2 text-center font-semibold text-foreground-muted transition-colors hover:border-subtle hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent min-h-8 text-xs`}>Edit</Link>
      <button type="button" onClick={onDownloadRaw} disabled={gone || rawState?.status === "working"} title={gone ? "Source footage is unavailable" : undefined} className={`rounded-lg border border-border px-2 font-medium text-foreground-muted transition-colors hover:border-subtle hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 min-h-8 text-xs`}>{gone ? "Footage unavailable" : rawLabel}</button>
      </div>
    </div>
    {readyState?.status === "working" && <p role="status" className="mt-2 text-xs text-foreground-muted">Building your finished clip with the hook and captions.</p>}
    {readyState?.status === "error" && <p role="alert" className="mt-2 text-xs text-red-400">{readyState.error} <button type="button" onClick={onDownloadReady} className="underline">Retry</button></p>}
    {rawState?.status === "working" && <p role="status" className="mt-2 text-xs text-foreground-muted">Extracting original video and audio. No Sparks charged.</p>}
    {rawState?.status === "error" && <p role="alert" className="mt-2 text-xs text-red-400">{rawState.error} <button type="button" onClick={onDownloadRaw} className="underline">Retry</button></p>}
  </article>;
}
