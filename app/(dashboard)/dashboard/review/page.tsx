"use client";

/**
 * /dashboard/review — the phone-friendly "keep or delete" screen the "your stream ended" email links to.
 * One clip at a time, best first. Keep records an approval (the same signal as the thumbs-up on the Clips page, which the
 * finder learns from); Delete records a rejection and removes the clip. Clips already rated are not shown again.
 * ?since=<time> limits it to the clips made by one automatic-clipping run; without it, the last 3 days.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { processingFetch } from "@/lib/processing-api";
import { loadClipThumbnail } from "@/lib/clip-thumbnails";
import type { SavedClip } from "@/lib/clip-ui";
import { reviewSince } from "@/lib/review-since";

function ReviewContent() {
  const searchParams = useSearchParams();
  const [clips, setClips] = useState<SavedClip[] | null>(null);
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState(0);
  const [deleted, setDeleted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const since = useRef(reviewSince(searchParams.get("since")));

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [{ data: rows }, { data: verdicts }] = await Promise.all([
        supabase.from("clips").select("*").gte("created_at", since.current).order("viral_score", { ascending: false }),
        supabase.from("clip_feedback").select("clip_id,verdict"),
      ]);
      const rated = new Set((verdicts ?? []).filter((v) => v.verdict === "approved" || v.verdict === "rejected").map((v) => v.clip_id));
      setClips(((rows ?? []) as SavedClip[]).filter((c) => !rated.has(c.id)));
    })().catch(() => setClips([]));
  }, []);

  const clip = clips && index < clips.length ? clips[index] : null;

  // Load the picture and the cut video for the clip on screen.
  useEffect(() => {
    if (!clip) return;
    let active = true;
    let blobUrl: string | null = null;
    setVideoUrl(null); setPoster(null); setVideoError(null);
    loadClipThumbnail(clip).then((u) => { if (active) setPoster(u); }).catch(() => {});
    processingFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip_id: clip.id, url: clip.url, start_seconds: clip.start_seconds, end_seconds: clip.end_seconds, crop: false }),
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("preview"))))
      .then((blob) => { if (!active) return; blobUrl = URL.createObjectURL(blob); setVideoUrl(blobUrl); })
      .catch(() => { if (active) setVideoError("The preview isn't ready yet. You can still keep or delete this clip."); });
    return () => { active = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [clip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (verdict: "approved" | "rejected") => {
    if (!clip || busy) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    const { error: rateError } = await supabase.rpc("record_clip_feedback", { p_clip_id: clip.id, p_signal: verdict });
    if (rateError) { setError("Couldn't save that. Try again."); setBusy(false); return; }
    if (verdict === "rejected") {
      const { error: deleteError } = await supabase.from("clips").delete().eq("id", clip.id);
      if (deleteError) { setError("Couldn't delete that clip. Try again."); setBusy(false); return; }
      setDeleted((n) => n + 1);
    } else setKept((n) => n + 1);
    setIndex((i) => i + 1);
    setBusy(false);
  };

  const total = clips?.length ?? 0;
  const seconds = clip ? Math.max(0, Math.round(clip.end_seconds - clip.start_seconds)) : 0;

  return (
    <div className="mx-auto max-w-md p-4 sm:p-8 animate-fade-in" data-review-page>
      <h1 className="font-syne text-2xl font-bold text-foreground">Review your clips</h1>
      {clips === null && <p className="mt-6 text-sm text-foreground-muted">Loading your clips…</p>}

      {clips !== null && total === 0 && (
        <div className="mt-6 rounded-xl border border-border bg-surface-2 p-5 text-sm text-foreground-muted">
          <p className="font-semibold text-foreground">Nothing to review</p>
          <p className="mt-1">You've already gone through the clips from this stream, or none were made.</p>
          <Link href="/dashboard/clips" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-background">Open my clips</Link>
        </div>
      )}

      {clip && (
        <div className="mt-4" data-review-card>
          <div className="mb-2 flex items-center justify-between text-xs text-foreground-muted">
            <span>Clip {index + 1} of {total}</span>
            <span>Score {Math.round(clip.viral_score)}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
            <div className="flex aspect-video items-center justify-center bg-background">
              {videoUrl
                ? <video key={clip.id} src={videoUrl} poster={poster ?? undefined} controls playsInline className="h-full w-full object-contain" />
                : poster
                  ? <img src={poster} alt="" className="h-full w-full object-cover" />
                  : <span className="text-xs text-foreground-muted">{videoError ?? "Loading preview…"}</span>}
            </div>
            <div className="p-4">
              <p className="text-sm font-semibold text-foreground">{clip.title}</p>
              <p className="mt-1 text-xs text-foreground-muted">{seconds} seconds</p>
              {videoError && videoUrl === null && poster && <p className="mt-2 text-xs text-foreground-muted">{videoError}</p>}
            </div>
          </div>
          {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => void decide("rejected")} data-review-delete
              className="min-h-12 rounded-xl border border-border bg-surface-2 text-sm font-semibold text-foreground transition-colors hover:border-subtle disabled:opacity-60">Delete</button>
            <button type="button" disabled={busy} onClick={() => void decide("approved")} data-review-keep
              className="min-h-12 rounded-xl bg-accent text-sm font-semibold text-background transition-colors hover:bg-accent-dim disabled:opacity-60">Keep</button>
          </div>
        </div>
      )}

      {clips !== null && total > 0 && !clip && (
        <div className="mt-6 rounded-xl border border-border bg-surface-2 p-5" data-review-done>
          <p className="text-base font-semibold text-foreground">All done</p>
          <p className="mt-1 text-sm text-foreground-muted">{kept} kept, {deleted} deleted.</p>
          <Link href="/dashboard/clips" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-background">Open my clips</Link>
        </div>
      )}
    </div>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={null}><ReviewContent /></Suspense>;
}
