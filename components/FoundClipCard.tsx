"use client";
import ClipThumbnail from './ClipThumbnail';
import type { SavedClip } from '@/lib/clip-ui';
import { fmtTime, TYPE_STYLES } from '@/lib/clip-ui';

export default function FoundClipCard({ clip, kept, busy, exporting, saving, isPro, onPreview, onCustomize, onExport, onRawExport, onKeep, onDiscard }: {
  clip: SavedClip; kept: boolean; busy: boolean; exporting: boolean; saving: boolean; isPro: boolean;
  onPreview: () => void; onCustomize: () => void; onExport: () => void; onRawExport: () => void;
  onKeep: () => void; onDiscard: () => void;
}) {
  return <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface p-4">
    <ClipThumbnail clip={clip} onPlay={onPreview} />
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${TYPE_STYLES[clip.clip_type] ?? ''}`}>{clip.clip_type.replaceAll('_', ' ')}</span>
      <span className="text-sm text-foreground-muted" title="AI estimate, not measured performance or a guarantee of views">AI score <strong className="ml-1 text-foreground">{Math.round(clip.viral_score)}<span className="font-normal text-muted">/100</span></strong></span>
    </div>
    <h4 className="mb-2 mt-3 min-h-[48px] line-clamp-2 font-geist text-lg font-semibold leading-6 text-foreground" title={clip.title}>{clip.title}</h4>
    <p className="mb-4 text-xs text-foreground-muted">VOD <span className="ml-1 font-mono">{fmtTime(clip.start_seconds)} – {fmtTime(clip.end_seconds)}</span></p>
    <div className="mt-auto grid grid-cols-3 gap-2">
      <button type="button" onClick={onPreview} disabled={busy} className="rounded-lg bg-accent px-2 py-2.5 text-sm font-semibold text-background hover:bg-accent-dim disabled:opacity-50">▶ Preview</button>
      <button type="button" onClick={onCustomize} disabled={busy} className="rounded-lg border border-border px-2 py-2.5 text-sm font-semibold text-foreground hover:border-accent/60 disabled:opacity-50">Customize</button>
      <button type="button" onClick={onExport} disabled={busy} className="rounded-lg border border-accent/40 px-2 py-2.5 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">{exporting ? 'Exporting…' : '↓ Export'}</button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
      {kept ? <span className="text-accent">✓ Saved to Found Moments</span> : <>
        <button type="button" onClick={onKeep} disabled={busy} className="min-h-8 font-semibold text-foreground-muted hover:text-accent disabled:opacity-50">{saving ? 'Saving…' : 'Keep'}</button>
        <button type="button" onClick={onDiscard} disabled={busy} className="min-h-8 text-foreground-muted hover:text-red-400 disabled:opacity-50">Discard</button>
      </>}
      <button type="button" onClick={onRawExport} disabled={busy} className="ml-auto min-h-8 text-foreground-muted hover:text-foreground disabled:opacity-50">Raw export{!isPro && <span className="ml-1 text-accent">· Pro</span>}</button>
    </div>
    {!isPro && <p className="mt-2 text-xs text-muted">Free exports include the Klyp watermark.</p>}
  </article>;
}
