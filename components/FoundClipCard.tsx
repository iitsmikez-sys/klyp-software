"use client";
import ClipThumbnail from './ClipThumbnail';
import type { SavedClip } from '@/lib/clip-ui';
import { fmtTime, platformName } from '@/lib/clip-ui';
import { backupState } from '@/lib/clip-backup-state';

export default function FoundClipCard({ clip, kept, busy, exporting, saving, rawSeconds, onPreview, onCustomize, onRawExport, onKeep, onDiscard }: {
  clip: SavedClip; kept: boolean; busy: boolean; exporting: boolean; saving: boolean; rawSeconds: number;
  onPreview: () => void; onCustomize: () => void; onRawExport: () => void;
  onKeep: () => void; onDiscard: () => void;
}) {
  const backup = backupState(clip.archive_status, clip.url);
  return <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface p-4">
    <ClipThumbnail clip={clip} onPlay={onPreview} />
    <h4 className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-foreground" title={clip.title}>{clip.title}</h4>
    <p className="mt-1 text-xs text-foreground-muted">{platformName(clip.url)} · VOD {fmtTime(clip.start_seconds)} · {clip.clip_type.replaceAll('_', ' ')}</p>
    <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
      <button type="button" onClick={onCustomize} disabled={busy} className="rounded-lg bg-accent px-2 py-2 text-sm font-semibold text-background hover:bg-accent-dim disabled:opacity-50">{saving ? 'Saving…' : 'Edit Clip'}</button>
      <button type="button" onClick={onRawExport} disabled={busy} className="rounded-lg border border-border px-2 py-2 text-sm font-medium text-foreground hover:border-accent/60 disabled:opacity-50">{exporting ? `Preparing ${rawSeconds}s…` : 'Download Raw'}</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
      {kept ? <span role="status" className={backup.kind === 'saved' ? 'text-accent' : 'text-amber-300'}>{backup.message}</span> : <>
        <button type="button" onClick={onKeep} disabled={busy} className="min-h-8 font-semibold text-foreground-muted hover:text-accent disabled:opacity-50">{saving ? 'Saving…' : 'Keep'}</button>
        <button type="button" onClick={onDiscard} disabled={busy} className="min-h-8 text-foreground-muted hover:text-red-400 disabled:opacity-50">Discard</button>
      </>}
      <button type="button" onClick={onPreview} disabled={busy} className="min-h-8 text-foreground-muted hover:text-foreground disabled:opacity-50">Preview</button>
    </div>
  </article>;
}
