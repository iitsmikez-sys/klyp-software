"use client";
import ClipThumbnail from './ClipThumbnail';
import ScoreBadge from './ScoreBadge';
import type { SavedClip } from '@/lib/clip-ui';
import { fmtTime, platformName } from '@/lib/clip-ui';
import { backupState, backupTone } from '@/lib/clip-backup-state';
import { isMediaExpired } from '@/lib/clip-expiry';
import { trackEvent } from '@/lib/track';

/**
 * One found clip. One clear button (Download), a plain note about how long it takes and how long it is saved, and the
 * rest (Edit, raw download, Keep, Discard) tucked under "More" so a first-time visitor is not facing nine buttons.
 */
export default function FoundClipCard({ clip, topPick = false, kept, busy, exporting, saving, rawSeconds, exportKind = 'raw', keptDays, showWatermarkNudge = false, onPreview, onCustomize, onRawExport, onReadyExport, onKeep, onDiscard }: {
  clip: SavedClip; topPick?: boolean; kept: boolean; busy: boolean; exporting: boolean; saving: boolean; rawSeconds: number;
  exportKind?: 'ready' | 'raw';
  /** How many days this plan keeps results and clips (5 on Free, 30 on Pro). */
  keptDays: number;
  /** Free accounts only: a quiet line under the download note that says free clips carry a watermark and links to Pro. */
  showWatermarkNudge?: boolean;
  onPreview: () => void; onCustomize: () => void; onRawExport: () => void; onReadyExport: () => void;
  onKeep: () => void; onDiscard: () => void;
}) {
  const backup = backupState(isMediaExpired(clip) ? 'expired' : clip.archive_status, clip.url);
  const readyWorking = exporting && exportKind === 'ready';
  return <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface p-4">
    <div className="relative">
      <ClipThumbnail clip={clip} onPlay={onPreview} />
      {topPick && <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-background">Top pick</span>}
      <ScoreBadge score={clip.viral_score} />
    </div>
    <h4 className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-foreground" title={clip.title}>{clip.title}</h4>
    <p className="mt-1 text-xs text-foreground-muted">{platformName(clip.url)} · VOD {fmtTime(clip.start_seconds)} · {clip.clip_type.replaceAll('_', ' ')}</p>
    <div className="mt-auto pt-4">
      <button type="button" onClick={onReadyExport} disabled={busy} className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-background hover:bg-accent-dim disabled:opacity-50">{readyWorking ? `Preparing ${rawSeconds}s…` : 'Download'}</button>
      <p data-download-note className="mt-1.5 text-center text-[11px] text-foreground-muted">{readyWorking ? `Keep this page open.` : `Saved for ${keptDays} days`}</p>
      {showWatermarkNudge && <p className="mt-1 text-center text-[11px]"><a href="/dashboard/upgrade" data-watermark-nudge onClick={() => void trackEvent('watermark_nudge_click')} className="text-accent hover:underline">Free clips include a Klyp watermark. Remove it with Pro</a></p>}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
      <button type="button" onClick={onPreview} disabled={busy} className="min-h-8 font-medium text-foreground-muted hover:text-foreground disabled:opacity-50">Preview</button>
      {kept && <span role="status" className={{ good: 'text-accent', quiet: 'text-foreground-muted', warn: 'text-amber-300' }[backupTone(backup.kind)]}>{backup.message}</span>}
    </div>
    <details data-more className="mt-1 text-xs">
      <summary className="min-h-8 cursor-pointer select-none py-1.5 font-medium text-foreground-muted hover:text-foreground">More</summary>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCustomize} disabled={busy} title="Change the captions, hook and layout before you download" className="rounded-lg border border-border px-2 py-1.5 font-medium text-foreground-muted hover:border-accent/60 hover:text-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Edit'}</button>
        <button type="button" onClick={onRawExport} disabled={busy} title="The original cut, with no captions or effects" className="rounded-lg border border-border px-2 py-1.5 font-medium text-foreground-muted hover:border-accent/60 hover:text-foreground disabled:opacity-50">{exporting && exportKind === 'raw' ? `Preparing ${rawSeconds}s…` : 'Download Raw'}</button>
        {!kept && <>
          <button type="button" onClick={onKeep} disabled={busy} title="Save this clip to your library" className="rounded-lg border border-border px-2 py-1.5 font-medium text-foreground-muted hover:border-accent/60 hover:text-accent disabled:opacity-50">{saving ? 'Saving…' : 'Keep'}</button>
          <button type="button" onClick={onDiscard} disabled={busy} title="Remove this clip from the list" className="rounded-lg border border-border px-2 py-1.5 font-medium text-foreground-muted hover:text-red-400 disabled:opacity-50">Discard</button>
        </>}
      </div>
    </details>
  </article>;
}
