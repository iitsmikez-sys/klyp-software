"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SavedClip } from "@/lib/clip-ui";
import ClipPreviewModal from "./ClipPreviewModal";
import CompactClipCard from "./CompactClipCard";
import { useRawClipDownloads } from "./useRawClipDownloads";
import { useClipExports } from "./useClipExports";
import { downloadExport } from "@/lib/clip-export";

const LIMIT = 4;
export default function SavedClips() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { rawDownloads, downloadRaw } = useRawClipDownloads();
  const { exports, createClip, invalidateClip } = useClipExports();
  useEffect(() => {
    let active = true;
    createClient().from("clips").select("*").order("created_at", { ascending: false }).limit(LIMIT)
      .then(({ data }) => { if (active) { setClips(data ?? []); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const pendingIds = clips.filter(c => c.archive_status !== 'stored' && c.archive_status !== 'unavailable').map(c => c.id).join(',');
  useEffect(() => {
    if (!pendingIds) return;
    let active = true;
    const refresh = async () => {
      const { data } = await createClient().from('clips').select('id,archive_status').in('id', pendingIds.split(','));
      if (!active || !data) return;
      const statuses = new Map(data.map(row => [row.id, row.archive_status]));
      setClips(previous => previous.map(clip => statuses.has(clip.id)
        ? { ...clip, archive_status: statuses.get(clip.id) } : clip));
    };
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pendingIds]);
  const previewClip = useMemo(() => clips.find(c => c.id === previewId), [clips, previewId]);
  return <section>
    <div className="mb-3 flex items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Saved Clips</h2>
        <p className="mt-0.5 text-xs text-foreground-muted">Your latest clips, ready to review or edit.</p>
      </div>
      <Link href="/dashboard/clips" className="shrink-0 text-sm font-medium text-foreground-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">View all clips →</Link>
    </div>
    {loading ? <div role="status" className="rounded-xl border border-border bg-surface p-6 text-sm text-foreground-muted">Loading clips…</div>
      : clips.length === 0 ? <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-foreground-muted">No saved clips yet. Analyze a VOD to find your first moments.</div>
      : <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${clips.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>{clips.map(clip => <CompactClipCard
        key={clip.id} clip={clip} compact onPreview={() => setPreviewId(clip.id)}
        rawState={rawDownloads[clip.id]} onDownloadRaw={() => void downloadRaw(clip)} />)}</div>}
    {previewClip && <ClipPreviewModal key={previewClip.id} clip={previewClip} onClose={() => setPreviewId(null)}
      onClipSaved={draft => { invalidateClip(previewClip.id); setClips(items => items.map(item => item.id === previewClip.id ? { ...item, edit_draft: draft } : item)); }}
      exportState={exports[previewClip.id]} onCreateClip={() => { void createClip(previewClip); }}
      onDownloadClip={() => { const ready = exports[previewClip.id]; if (ready) downloadExport(ready, previewClip.id); }}
      rawState={rawDownloads[previewClip.id]} onDownloadRaw={() => void downloadRaw(previewClip)} />}
  </section>;
}
