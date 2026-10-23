"use client";

/**
 * Inline editing panel for a saved clip (My Clips page). Mirrors the dashboard
 * analyze-flow export options: preview player, hook picker + hook text style,
 * caption style, format, and export. Hook options / caption words come from the
 * clips row (hooks/words columns, migration 003) — clips saved before that
 * migration can still be previewed and exported, just without those extras.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_LABELS, type CaptionStyle, type ExportFormat, type TimedWord } from "@/lib/clips";
import { buildCaptionCues, HOOK_STYLES, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import { drawCaptionPreview } from "@/lib/caption-preview";
import { CAPTION_COLORS, CAPTION_HEX, CAPTION_POSITIONS, type CaptionColor, type CaptionPosition } from "@/lib/editor-captions";
import { useSparks } from "./SparksProvider";
import ProGateModal from "./ProGateModal";
import ClipTrimControl from "./ClipTrimControl";
import { archivedClipTiming } from "@/lib/clip-trim";
import type { SavedClip } from "@/lib/clip-ui";
import { processingFetch } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";
import {
  deleteSegment, parseSegments, retimeWords, segmentIndexAtSource, splitSegment,
  timelineDuration, trimSegment, type EditSegment,
} from "@/lib/edit-segments";
import {
  buildEditorTimeline, mediaAfterDelete, mediaAfterSplit, outputTimeForSource,
  parseMediaInserts, retimeWordsWithMedia, timelineItemAt, type MediaInsert,
} from "@/lib/editor-media";

type EditorMedia = MediaInsert & { name: string; url?: string };

/** Give a first-time source-VOD download plenty of room, but fail loudly eventually. */
const PREVIEW_TIMEOUT_MS = 6 * 60_000;
/** Export can include a first-time source download + full-quality burn — generous but finite. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;

const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  CLASSIC: "Classic — bold white, thick black outline",
  IMPACT: "Impact — heavy meme callout (default)",
  YELLOW: "Yellow — subtitle yellow",
  BOXED: "Boxed — white on black bar",
  NEON: "Neon — Klyp green",
};

function fmtClipTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SavedClipEditor({
  clip,
  workspace = false,
}: { clip: SavedClip; workspace?: boolean }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [transcriptOnly, setTranscriptOnly] = useState(false);
  const [proGateOpen, setProGateOpen] = useState(false);
  const { tier } = useSparks();
  const isPro = tier === "pro";

  const hooks = Array.isArray(clip.hooks) ? clip.hooks : [];
  const hasWords = Array.isArray(clip.words) && clip.words.length > 0;

  // Transcript cues for the scene analysis panel — clip-relative timestamps.
  const transcriptCues = useMemo(() => {
    if (!Array.isArray(clip.words) || clip.words.length === 0) return [];
    const cues: { t: number; text: string }[] = [];
    for (let i = 0; i < clip.words.length; i += 8) {
      const group = clip.words.slice(i, i + 8);
      cues.push({
        t: Math.max(0, group[0].start / 1000 - clip.start_seconds),
        text: group.map((w) => w.text).join(" "),
      });
    }
    return cues;
  }, [clip]);

  const [selectedHook, setSelectedHook] = useState<string | null>(hooks[0] ?? null);
  const [hookStyle, setHookStyle] = useState<HookStyle>("IMPACT");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("BOLD");
  const [captionColor, setCaptionColor] = useState<CaptionColor>("DEFAULT");
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>("BOTTOM");
  const [captionWords, setCaptionWords] = useState<TimedWord[]>(Array.isArray(clip.words) ? clip.words : []);
  const [editingCaptionIndex, setEditingCaptionIndex] = useState<number | null>(null);
  const [editingHook, setEditingHook] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("9:16");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewLeadSeconds, setPreviewLeadSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewDuration, setPreviewDuration] = useState(
    Math.max(0, clip.end_seconds - clip.start_seconds)
  );
  const sourceDuration = Math.max(0, clip.end_seconds - clip.start_seconds);
  const [segments, setSegments] = useState<EditSegment[]>([
    { start: 0, end: sourceDuration },
  ]);
  const [media, setMedia] = useState<EditorMedia[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null);
  const [mediaTime, setMediaTime] = useState(0);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState(0);
  const activeSourceIndexRef = useRef(0);
  const [undoStack, setUndoStack] = useState<Array<{
    segments: EditSegment[]; media: EditorMedia[]; selected: number; time: number;
  }>>([]);
  const lastTrimRef = useRef<{ section: number; at: number } | null>(null);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);
  const timelineItems = useMemo(() => buildEditorTimeline(segments, media), [segments, media]);
  const editedDuration = timelineItems.at(-1)?.end ?? timelineDuration(segments);
  const activeMedia = activeMediaIndex === null ? null : media[activeMediaIndex];
  const editedTime = activeMediaIndex === null
    ? outputTimeForSource(timelineItems, currentTime)
    : (timelineItems.find((item) => item.mediaIndex === activeMediaIndex)?.start ?? 0) + mediaTime;
  const editedTimeRef = useRef(editedTime);
  editedTimeRef.current = editedTime;
  const outputCaptionWords = useMemo(() => {
    if (!hasWords) return [];
    const words = media.length
      ? retimeWordsWithMedia(captionWords, clip.start_seconds, segments, media)
      : retimeWords(captionWords, clip.start_seconds, segments);
    return words;
  }, [captionWords, clip.start_seconds, hasWords, segments, media]);
  const liveCaptionCues = useMemo(() => buildCaptionCues(outputCaptionWords, 0, editedDuration * 1000,
    captionStyle === "KLYP" ? 1 : 4), [outputCaptionWords, editedDuration, captionStyle]);
  const editedCaptionCues = useMemo(() => {
    const cues: { t: number; text: string }[] = [];
    for (let i = 0; i < outputCaptionWords.length; i += 8) {
      const group = outputCaptionWords.slice(i, i + 8);
      cues.push({ t: group[0].start / 1000, text: group.map((word) => word.text).join(" ") });
    }
    return cues;
  }, [outputCaptionWords]);

  const seekOutput = (seconds: number, autoPlay = false) => {
    const target = Math.max(0, Math.min(seconds, editedDuration));
    const item = timelineItemAt(timelineItems, target);
    if (!item) return;
    videoRef.current?.pause();
    mediaVideoRef.current?.pause();
    setPlaying(autoPlay);
    if (item.kind === "source") {
      const sourceTime = item.sourceStart! + Math.min(target - item.start, item.end - item.start);
      setActiveMediaIndex(null);
      setSelectedMediaIndex(null);
      setSelectedSegment(item.sourceIndex!);
      activeSourceIndexRef.current = item.sourceIndex!;
      if (videoRef.current) {
        videoRef.current.currentTime = sourceTime + previewLeadSeconds;
        if (autoPlay) videoRef.current.play().catch(() => setPlaying(false));
      }
      setCurrentTime(sourceTime);
    } else {
      setActiveMediaIndex(item.mediaIndex!);
      setSelectedMediaIndex(item.mediaIndex!);
      setMediaTime(Math.max(0, target - item.start));
      if (!media[item.mediaIndex!]?.url) setPlaying(false);
    }
  };

  const seekTo = (seconds: number) => {
    const target = Math.max(0, Math.min(seconds, previewDuration - previewLeadSeconds));
    const kept = segmentIndexAtSource(segments, target);
    const actual = kept >= 0 ? target
      : segments.find((segment) => segment.start > target)?.start ?? segments[segments.length - 1].end;
    seekOutput(outputTimeForSource(timelineItems, actual));
  };

  const togglePlayback = () => {
    if (!playing && editedTime >= editedDuration - 0.05) return seekOutput(0, true);
    if (playing) {
      videoRef.current?.pause();
      mediaVideoRef.current?.pause();
      setPlaying(false);
    } else if (activeMedia) {
      setPlaying(true);
      if (activeMedia.kind === "video") mediaVideoRef.current?.play().catch(() => setPlaying(false));
    } else {
      const video = videoRef.current;
      if (!video) return;
      if (editedTime >= editedDuration - 0.05) return seekOutput(0, true);
      setPlaying(true);
      video.play().catch(() => setPlaying(false));
    }
  };

  const onPreviewTimeUpdate = (video: HTMLVideoElement) => {
    if (activeMediaIndex !== null) return;
    const time = video.currentTime - previewLeadSeconds;
    const activeSource = timelineItems.find((entry) => entry.kind === "source" &&
      entry.sourceIndex === activeSourceIndexRef.current);
    if (activeSource && time >= activeSource.sourceEnd! - 0.04) {
      if (activeSource.end >= editedDuration - 0.04) {
        video.pause();
        setPlaying(false);
        setCurrentTime(activeSource.sourceEnd!);
      } else seekOutput(activeSource.end, playing);
      return;
    }
    const index = segmentIndexAtSource(segments, time);
    const item = timelineItems.find((entry) => entry.kind === "source" && entry.sourceIndex === index);
    if (!item || time >= item.sourceEnd! - 0.04) {
      const next = item ? item.end : outputTimeForSource(timelineItems, time);
      if (next >= editedDuration - 0.04) {
        video.pause();
        setPlaying(false);
        setCurrentTime(segments[segments.length - 1].end);
      } else seekOutput(next, playing);
      return;
    }
    setCurrentTime(time);
    setSelectedSegment(index);
    activeSourceIndexRef.current = index;
  };

  const applySegments = (next: EditSegment[], selected: number, trim = false, nextMedia = media) => {
    if (next === segments) return;
    const now = Date.now();
    const sameTrim = trim && lastTrimRef.current?.section === selected &&
      now - lastTrimRef.current.at < 800;
    if (!sameTrim) {
      setUndoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
    }
    lastTrimRef.current = trim ? { section: selected, at: now } : null;
    setSegments(next);
    setMedia(nextMedia);
    setActiveMediaIndex(null);
    setPlaying(false);
    setSelectedSegment(selected);
    activeSourceIndexRef.current = selected;
    const video = videoRef.current;
    const target = next[selected]?.start ?? next[0].start;
    if (video) video.currentTime = target + previewLeadSeconds;
    setCurrentTime(target);
  };

  const splitAtPlayhead = () => {
    if (activeMediaIndex !== null) return;
    const index = segmentIndexAtSource(segments, currentTime);
    if (index < 0) return;
    const next = splitSegment(segments, index, currentTime);
    applySegments(next, index + 1, false, next === segments ? media : mediaAfterSplit(media, index));
  };

  const removeSelected = () => {
    if (selectedMediaIndex !== null) {
      applyMedia(media.filter((_, index) => index !== selectedMediaIndex));
      return;
    }
    const next = deleteSegment(segments, selectedSegment);
    applySegments(next, Math.min(selectedSegment, next.length - 1), false,
      next === segments ? media : mediaAfterDelete(media, selectedSegment));
  };

  const applyMedia = (next: EditorMedia[]) => {
    if (next === media) return;
    setUndoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
    setMedia(next);
    const firstImported = next.findIndex((item) => item.after === -1);
    setActiveMediaIndex(firstImported >= 0 && currentTime <= segments[0].start ? firstImported : null);
    setSelectedMediaIndex(firstImported >= 0 && currentTime <= segments[0].start ? firstImported : null);
    setMediaTime(0);
    setPlaying(false);
    videoRef.current?.pause();
    mediaVideoRef.current?.pause();
  };

  const trimSelected = (start: number, end: number) => {
    const selected = segments[selectedSegment];
    if (!selected) return;
    const handle = start !== selected.start ? "start" : "end";
    const proposed = handle === "start" ? start : end;
    applySegments(trimSegment(segments, selectedSegment, handle, proposed, sourceDuration), selectedSegment, true);
  };

  const undoEdit = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    lastTrimRef.current = null;
    setUndoStack((history) => history.slice(0, -1));
    setSegments(previous.segments);
    setMedia(previous.media);
    setActiveMediaIndex(null);
    setSelectedMediaIndex(null);
    setPlaying(false);
    setSelectedSegment(previous.selected);
    activeSourceIndexRef.current = previous.selected;
    if (videoRef.current) videoRef.current.currentTime = previous.time + previewLeadSeconds;
    setCurrentTime(previous.time);
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const uploadMedia = async (file: File) => {
    setMediaError(null);
    if (media.length >= 8) return setMediaError("You can add up to 8 images or videos.");
    if (file.size > 50 * 1024 * 1024) return setMediaError("Imported media must be under 50 MB.");
    setUploadingMedia(true);
    try {
      const response = await processingFetch("/api/editor-media", {
        method: "POST",
        headers: { "x-clip-id": clip.id, "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not import media.");
      const next = [...media, { id: result.id, kind: result.kind, duration: result.duration,
        after: selectedSegment, name: file.name, url: result.url } as EditorMedia];
      parseMediaInserts(next, segments);
      applyMedia(next);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not import media.");
    } finally {
      setUploadingMedia(false);
    }
  };

  // Keep the user's hook and export choices when they close and reopen the editor.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`klyp-editor-${clip.id}`);
      if (raw) {
        const saved = JSON.parse(raw) as {
          hook?: string | null; hookStyle?: HookStyle;
          captionStyle?: CaptionStyle; captionColor?: CaptionColor;
          captionPosition?: CaptionPosition; captionEdits?: unknown;
          format?: ExportFormat;
          segments?: unknown; media?: unknown;
        };
        if (typeof saved.hook === "string" || saved.hook === null) setSelectedHook(saved.hook);
        if (saved.hookStyle && HOOK_STYLES.includes(saved.hookStyle)) setHookStyle(saved.hookStyle);
        if (saved.captionStyle && CAPTION_STYLES.includes(saved.captionStyle)) setCaptionStyle(saved.captionStyle);
        if (saved.captionColor && CAPTION_COLORS.includes(saved.captionColor)) setCaptionColor(saved.captionColor);
        if (saved.captionPosition && CAPTION_POSITIONS.includes(saved.captionPosition)) setCaptionPosition(saved.captionPosition);
        const savedEdits = saved.captionEdits;
        if (Array.isArray(savedEdits) && savedEdits.length === clip.words?.length &&
            savedEdits.every((text) => typeof text === "string" && text.length <= 80)) {
          setCaptionWords(clip.words!.map((word, index) => ({ ...word, text: savedEdits[index] as string })));
        }
        if (saved.format && EXPORT_FORMATS.includes(saved.format)) setFormat(saved.format);
        const loadedSegments = saved.segments ? parseSegments(saved.segments, sourceDuration)
          : [{ start: 0, end: sourceDuration }];
        if (saved.segments) setSegments(loadedSegments);
        if (saved.media) {
          const parsed = parseMediaInserts(saved.media, loadedSegments);
          const named = parsed.map((entry, index) => ({ ...entry,
            name: typeof (saved.media as EditorMedia[])[index]?.name === "string"
              ? (saved.media as EditorMedia[])[index].name.slice(0, 100) : `Imported ${entry.kind}` }));
          setMedia(named);
          const firstImported = named.findIndex((item) => item.after === -1);
          if (firstImported >= 0) {
            setActiveMediaIndex(firstImported);
            setSelectedMediaIndex(firstImported);
          }
          named.forEach(async (entry) => {
            try {
              const response = await processingFetch(`/api/editor-media?clip_id=${encodeURIComponent(clip.id)}&id=${entry.id}&kind=${entry.kind}`);
              if (!response.ok) return;
              const data = await response.json();
              setMedia((current) => current.map((item) => item.id === entry.id ? { ...item, url: data.url } : item));
            } catch { /* The missing item remains visible so the user can remove it. */ }
          });
        }
      }
    } catch { /* A malformed old draft should not prevent editing. */ }
    setDraftReady(true);
  }, [clip.id]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      localStorage.setItem(`klyp-editor-${clip.id}`, JSON.stringify({
        hook: selectedHook, hookStyle, captionStyle, captionColor, captionPosition,
        captionEdits: captionWords.map((word) => word.text), format, segments,
        media: media.map(({ id, kind, after, duration, name }) => ({ id, kind, after, duration, name })),
      }));
    } catch { /* Storage can be unavailable; editing and export still work. */ }
  }, [clip.id, draftReady, selectedHook, hookStyle, captionStyle, captionColor, captionPosition, captionWords, format, segments, media]);

  useEffect(() => {
    const item = activeMediaIndex === null ? null : media[activeMediaIndex];
    if (!item || item.kind !== "video" || !mediaVideoRef.current) return;
    mediaVideoRef.current.currentTime = mediaTime;
    if (playing) mediaVideoRef.current.play().catch(() => setPlaying(false));
    else mediaVideoRef.current.pause();
  }, [activeMediaIndex, playing, activeMedia?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const item = activeMediaIndex === null ? null : media[activeMediaIndex];
    if (!item || item.kind !== "image" || !playing) return;
    const timelineItem = timelineItems.find((entry) => entry.mediaIndex === activeMediaIndex);
    if (!timelineItem) return;
    const started = performance.now() - mediaTime * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = (now - started) / 1000;
      if (elapsed >= item.duration) {
        seekOutput(timelineItem.end, timelineItem.end < editedDuration - 0.001);
      } else {
        setMediaTime(elapsed);
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeMediaIndex, playing, timelineItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live hook overlay on the preview — mirrors the export burn and reacts
  // instantly to hook/style changes (the loop redraws every frame, playing or not).
  useEffect(() => {
    if (!previewUrl) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const draw = () => {
      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (selectedHook) {
        drawHookPreview(ctx, editedTimeRef.current, selectedHook, hookStyle, canvas.width, canvas.height);
      }
      drawCaptionPreview(ctx, editedTimeRef.current, liveCaptionCues, captionStyle,
        { color: captionColor, position: captionPosition }, canvas.width, canvas.height);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [previewUrl, selectedHook, hookStyle, liveCaptionCues, captionStyle, captionColor, captionPosition]);

  const onPreviewOverlayClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const y = event.nativeEvent.offsetY / Math.max(canvas.clientHeight, 1);
    const captionY = captionPosition === "TOP" ? 400 / 1920
      : captionPosition === "CENTER" ? 0.5 : 1 - 80 / 1920;
    const activeCue = liveCaptionCues.find((cue) => editedTime * 1000 >= cue.startMs && editedTime * 1000 < cue.endMs);
    if (activeCue && activeMediaIndex === null && Math.abs(y - captionY) < 0.12) {
      const sourceMs = (clip.start_seconds + currentTime) * 1000;
      let index = captionWords.findIndex((word) => sourceMs >= word.start && sourceMs < word.end);
      if (index < 0) index = captionWords.findIndex((word) => word.start >= sourceMs);
      if (index < 0) index = captionWords.length - 1;
      setEditingCaptionIndex(index);
      setEditingHook(false);
      return;
    }
    if (selectedHook && editedTime < 3 && y < 0.35) {
      setEditingHook(true);
      setEditingCaptionIndex(null);
      return;
    }
    togglePlayback();
  };

  // The native timeupdate event fires only a few times per second. Check cut
  // boundaries each animation frame so playback does not reveal a deleted beat.
  useEffect(() => {
    if (!previewUrl) return;
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const followCuts = () => {
      if (!video.paused) {
        const active = segments[activeSourceIndexRef.current];
        if (!active || video.currentTime - previewLeadSeconds >= active.end - 0.03) {
          onPreviewTimeUpdate(video);
        }
      }
      frame = requestAnimationFrame(followCuts);
    };
    frame = requestAnimationFrame(followCuts);
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, segments, media, activeMediaIndex, playing, previewLeadSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the cut preview on expand (source video is cached server-side per URL).
  // First view of a VOD legitimately takes minutes (full source download), so
  // the timeout is generous — but finite, so a wedged request fails loudly
  // instead of spinning forever. Aborting the fetch doesn't cancel the server
  // download, so a Retry after a timeout usually joins the finished cache.
  useEffect(() => {
    let blobUrl: string | null = null;
    let timedOut = false;
    setLoadingPreview(true);
    setLoadError(null);
    setElapsed(0);
    const startedAt = Date.now();
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, PREVIEW_TIMEOUT_MS);
    const settle = () => { clearInterval(ticker); clearTimeout(timeout); };

    processingFetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clip_id: clip.id,
        url: clip.url,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d?.error ?? "Preview failed.")));
        const lead = res.headers.get("X-Klyp-Source") === "archive"
          ? archivedClipTiming(clip.start_seconds).previewLead : 0;
        return res.blob().then((blob) => ({ blob, lead }));
      })
      .then(({ blob, lead }) => {
        settle();
        blobUrl = URL.createObjectURL(blob);
        setPreviewLeadSeconds(lead);
        setPreviewUrl(blobUrl);
        setLoadingPreview(false);
      })
      .catch((err: Error) => {
        settle();
        if (controller.signal.aborted && !timedOut) return; // unmounted — leave state alone
        setLoadError(
          timedOut
            ? `Preview timed out after ${Math.round(PREVIEW_TIMEOUT_MS / 60_000)} minutes. The source VOD may still be downloading in the background — hit Retry in a bit.`
            : err.message
        );
        setLoadingPreview(false);
      });
    return () => {
      settle();
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [clip.id, retryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportClip = async () => {
    setExporting(true);
    setExportError(null);
    // Timeout so a hung export fails loudly instead of spinning forever. The
    // server keeps working after an abort, so a retry usually hits a warm cache.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    try {
      const res = await processingFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clip_id: clip.id,
          url: clip.url,
          start_seconds: clip.start_seconds,
          end_seconds: clip.end_seconds,
          segments,
          media: media.map(({ id, kind, after, duration }) => ({ id, kind, after, duration })),
          title: clip.title,
          style: hasWords ? captionStyle : undefined,
          words: hasWords ? clip.words : undefined,
          caption_edits: hasWords ? captionWords.map((word) => ({ text: word.text })) : undefined,
          caption_color: captionColor,
          caption_position: captionPosition,
          hook: selectedHook ?? undefined,
          hook_style: hookStyle,
          handle: getStoredHandle(),
          aspect_ratio: format,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Export failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const safe = clip.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = (safe || "klyp_clip") + ".mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setExportError(
        controller.signal.aborted
          ? "Export timed out after 10 minutes — the source VOD may still be downloading in the background. Try again in a bit."
          : err instanceof Error ? err.message : "Export failed."
      );
    } finally {
      clearTimeout(timeout);
      setExporting(false);
    }
  };

  return (
    <div className={workspace ? "pt-4" : "mt-4 pt-4 border-t border-border"} onClick={(e) => e.stopPropagation()}>
      <div className={workspace
        ? "grid grid-cols-1 lg:grid-cols-[minmax(230px,1fr)_minmax(360px,2fr)_minmax(260px,1fr)] gap-4 items-start"
        : "grid grid-cols-1 lg:grid-cols-2 gap-6 items-start"}>

      {/* ── Scene analysis (left): description + transcript with timestamps ── */}
      <div className={workspace
        ? "order-2 lg:order-1 min-w-0 rounded-xl border border-border bg-background p-4 space-y-3"
        : "space-y-3"}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
            Transcript / Scene Analysis
          </p>
          <button
            type="button"
            onClick={() => setTranscriptOnly((v) => !v)}
            className={`px-2.5 py-1 rounded-md border text-[10px] font-bold font-syne tracking-wide transition-colors ${
              transcriptOnly
                ? "bg-accent-glow border-accent/50 text-accent"
                : "border-border text-foreground-muted hover:border-subtle"
            }`}
          >
            Transcript only
          </button>
        </div>

        {!transcriptOnly && (
          <div className="px-3.5 py-3 rounded-lg bg-surface-2 border border-border space-y-1.5">
            <p className="text-[10px] font-bold font-syne tracking-wide text-accent">{clip.clip_type}</p>
            {clip.reason && <p className="text-xs text-foreground-muted leading-relaxed">{clip.reason}</p>}
            {clip.caption && <p className="text-xs text-subtle leading-relaxed italic">{clip.caption}</p>}
          </div>
        )}

        {transcriptCues.length > 0 ? (
          <div className="max-h-96 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-surface-2/50 divide-y divide-border">
            {transcriptCues.map((cue, i) => (
              <button
                key={i}
                type="button"
                onClick={() => seekTo(cue.t)}
                disabled={segmentIndexAtSource(segments, cue.t) < 0}
                className="w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-surface-2 focus:outline-none focus:bg-surface-2 disabled:opacity-35 disabled:line-through disabled:cursor-not-allowed"
              >
                <span className="flex-shrink-0 text-[10px] font-mono text-accent mt-0.5">
                  {fmtClipTime(cue.t)}
                </span>
                <p className="text-xs text-foreground-muted leading-relaxed">{cue.text}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No transcript saved for this clip — it was analyzed before word timestamps were stored.
          </p>
        )}
      </div>

      {/* ── Vertical preview (centre) ── */}
      <div className="order-1 lg:order-2 min-w-0 rounded-xl border border-border bg-background p-3">
        <p className="mb-3 text-sm font-semibold text-foreground">Preview</p>
        <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: "9/16", maxHeight: workspace ? "min(58dvh, 660px)" : 380 }}>
        {loadingPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground-muted">
            <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-xs text-center px-4">
              Generating preview…{elapsed >= 5 ? ` (${fmtClipTime(elapsed)})` : ""}<br />
              <span className="text-subtle">
                {elapsed < 30
                  ? "(downloads source video first time)"
                  : "Still downloading the source VOD — long VODs can take several minutes."}
              </span>
            </span>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
            <p className="text-red-400 text-xs text-center">{loadError}</p>
            <button
              onClick={() => setRetryToken((t) => t + 1)}
              className="px-3 py-1.5 rounded-md border border-border text-xs font-bold font-syne text-foreground-muted hover:text-foreground hover:border-accent/50 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {previewUrl && (
          <>
            <video
              ref={videoRef}
              src={previewUrl}
              className="w-full h-full object-contain cursor-pointer"
              playsInline
              onClick={togglePlayback}
              muted={muted}
              onTimeUpdate={(e) => onPreviewTimeUpdate(e.currentTarget)}
              onLoadedMetadata={(e) => {
                setPreviewDuration(e.currentTarget.duration || previewDuration);
                e.currentTarget.currentTime = segments[0].start + previewLeadSeconds;
                if (timelineItems[0]?.kind !== "source") seekOutput(0);
              }}
            />
            {activeMedia && (
              activeMedia.url ? activeMedia.kind === "image" ? (
                <img src={activeMedia.url} alt={activeMedia.name}
                  className="absolute inset-0 h-full w-full object-contain bg-black cursor-pointer"
                  onClick={togglePlayback} />
              ) : (
                <video key={activeMedia.id} ref={mediaVideoRef} src={activeMedia.url}
                  className="absolute inset-0 h-full w-full object-contain bg-black cursor-pointer"
                  playsInline muted={muted} onClick={togglePlayback}
                  onLoadedMetadata={(event) => { event.currentTarget.currentTime = mediaTime; }}
                  onTimeUpdate={(event) => {
                    const next = event.currentTarget.currentTime;
                    setMediaTime(next);
                    const item = timelineItems.find((entry) => entry.mediaIndex === activeMediaIndex);
                    if (item && next >= activeMedia.duration - 0.04) {
                      seekOutput(item.end, playing && item.end < editedDuration - 0.001);
                    }
                  }}
                  onEnded={() => {
                    const item = timelineItems.find((entry) => entry.mediaIndex === activeMediaIndex);
                    if (item) seekOutput(item.end, playing && item.end < editedDuration - 0.001);
                  }} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-black p-4 text-center text-xs text-red-300">
                  This imported file is unavailable. Remove it or import it again.
                </div>
              )
            )}
            <canvas ref={canvasRef} onClick={onPreviewOverlayClick}
              aria-label="Click the hook or captions to edit them; click elsewhere to play or pause"
              className="absolute inset-0 w-full h-full cursor-text" />
            {editingHook && (
              <div className="absolute left-3 right-3 top-[8%] z-10 rounded-lg border border-accent bg-background/95 p-2 shadow-xl">
                <label className="block text-[10px] font-bold text-accent mb-1">Edit hook</label>
                <input autoFocus value={selectedHook ?? ""} maxLength={80}
                  onChange={(event) => setSelectedHook(event.target.value || null)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") setEditingHook(false); }}
                  className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground" />
                <button type="button" onClick={() => setEditingHook(false)} className="mt-1 text-[10px] text-accent">Done</button>
              </div>
            )}
            {editingCaptionIndex !== null && captionWords[editingCaptionIndex] && (
              <div className="absolute left-3 right-3 top-[38%] z-10 rounded-lg border border-accent bg-background/95 p-2 shadow-xl">
                <label className="block text-[10px] font-bold text-accent mb-1">Edit caption word {editingCaptionIndex + 1} of {captionWords.length}</label>
                <input autoFocus value={captionWords[editingCaptionIndex].text} maxLength={80}
                  onChange={(event) => setCaptionWords((current) => current.map((word, index) =>
                    index === editingCaptionIndex ? { ...word, text: event.target.value } : word))}
                  onKeyDown={(event) => { if (event.key === "Escape") setEditingCaptionIndex(null); }}
                  className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground" />
                <div className="mt-1 flex items-center justify-between text-[10px] text-accent">
                  <button type="button" disabled={editingCaptionIndex === 0}
                    onClick={() => setEditingCaptionIndex((index) => index === null ? null : Math.max(0, index - 1))}>Previous</button>
                  <button type="button" onClick={() => setEditingCaptionIndex(null)}>Done</button>
                  <button type="button" disabled={editingCaptionIndex === captionWords.length - 1}
                    onClick={() => setEditingCaptionIndex((index) => index === null ? null : Math.min(captionWords.length - 1, index + 1))}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-xs text-foreground-muted">
          <button type="button" onClick={togglePlayback} disabled={!previewUrl} className="rounded-md border border-border px-3 py-1 text-foreground hover:border-accent/50 disabled:opacity-40">
            {playing ? "Pause" : "Play"}
          </button>
          <span className="font-mono">{fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}</span>
          <button type="button" onClick={() => setMuted((value) => !value)} disabled={!previewUrl} className="rounded-md border border-border px-2 py-1 text-foreground hover:border-accent/50 disabled:opacity-40" aria-label={muted ? "Unmute preview" : "Mute preview"}>
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      <p className="text-[10px] text-subtle text-center mt-1">
        Click the hook or captions in the preview to edit their text.
      </p>
      </div>

      {/* ── Editing controls (right) ── */}
      <div className="order-3 min-w-0 space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Clip settings</h3>
        <span className="text-[10px] text-subtle">Saved on this device</span>
      </div>
      {workspace && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-foreground-muted">
          <p className="font-semibold text-foreground">Section {selectedSegment + 1} of {segments.length}</p>
          <p className="mt-1 font-mono">
            {fmtClipTime(segments[selectedSegment]?.start ?? 0)}–{fmtClipTime(segments[selectedSegment]?.end ?? 0)} in the original moment
          </p>
        </div>
      )}

      {/* Hook options */}
      <div>
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
          Hook{" "}
          <span className="font-normal normal-case tracking-normal text-subtle">
            — shown on screen for the first 3s
          </span>
        </p>
        {hooks.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {hooks.map((hookText) => {
              const selected = selectedHook === hookText;
              return (
                <button
                  key={hookText}
                  onClick={() => setSelectedHook(selected ? null : hookText)}
                  disabled={exporting}
                  className={`text-left px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                    selected
                      ? "bg-accent-glow border-accent/50 text-accent font-semibold"
                      : "bg-surface-2 border-border text-foreground-muted hover:border-subtle"
                  }`}
                >
                  {selected ? "✓ " : ""}{hookText}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No hook options saved for this clip — it was analyzed before hooks were stored. Type your own below.
          </p>
        )}
        {/* Editable hook text — picking an option above fills this in; tweak freely. */}
        <input
          type="text"
          value={selectedHook ?? ""}
          onChange={(e) => setSelectedHook(e.target.value.length > 0 ? e.target.value.slice(0, 80) : null)}
          placeholder="Type a custom hook, or pick one above"
          maxLength={80}
          disabled={exporting}
          className="mt-1.5 w-full px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs text-foreground placeholder:text-subtle focus:outline-none focus:border-accent/50 disabled:opacity-50"
        />
        <p className="text-[10px] text-subtle mt-1">
          Burned on screen in ALL CAPS for the first 3s — clear the field to export without a hook.
        </p>
      </div>

      {/* Hook text style */}
      {selectedHook && (
        <div>
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
            Hook Text Style
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setHookStyle(s)}
                disabled={exporting}
                title={HOOK_STYLE_LABELS[s]}
                className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  hookStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-subtle mt-1.5">{HOOK_STYLE_LABELS[hookStyle]}</p>
        </div>
      )}

      {/* Caption style */}
      <div>
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
          Caption Style
        </p>
        {hasWords ? (
          <div className="flex gap-2">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setCaptionStyle(s)}
                disabled={exporting}
                className={`flex-1 py-1.5 rounded-md border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  captionStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {s === "KLYP" ? "⚡ KLYP" : s}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-subtle">
            No word timestamps saved for this clip — captions aren&apos;t available. New analyses save them automatically.
          </p>
        )}
      </div>

      {hasWords && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">Caption color</p>
            <div className="flex flex-wrap gap-1.5">
              {CAPTION_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setCaptionColor(color)} disabled={exporting}
                  className={`rounded-md border px-2 py-1 text-[10px] font-bold ${captionColor === color ? "border-accent text-accent bg-accent-glow" : "border-border text-foreground-muted"}`}>
                  {color !== "DEFAULT" && <span className="mr-1 inline-block h-2 w-2 rounded-full border border-black/30" style={{ background: CAPTION_HEX[color] }} />}
                  {color === "DEFAULT" ? "Style default" : color[0] + color.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">Caption position</p>
            <div className="flex gap-1.5">
              {CAPTION_POSITIONS.map((position) => (
                <button key={position} type="button" onClick={() => setCaptionPosition(position)} disabled={exporting}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[10px] font-bold ${captionPosition === position ? "border-accent text-accent bg-accent-glow" : "border-border text-foreground-muted"}`}>
                  {position[0] + position.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => {
            const sourceMs = (clip.start_seconds + currentTime) * 1000;
            const index = captionWords.findIndex((word) => word.end >= sourceMs);
            setEditingCaptionIndex(index < 0 ? captionWords.length - 1 : index);
            setEditingHook(false);
          }} className="text-[11px] font-semibold text-accent hover:underline">
            Edit caption words at playhead
          </button>
        </div>
      )}

      {/* Format */}
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
          Format
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {EXPORT_FORMATS.map((f) => {
            const locked = !isPro && f !== "9:16";
            return (
              <button
                key={f}
                onClick={() => (locked ? setProGateOpen(true) : setFormat(f))}
                disabled={exporting}
                title={locked ? "Format switching is a Pro feature" : FORMAT_LABELS[f]}
                className={`px-2.5 py-1.5 text-[11px] font-bold font-syne transition-colors disabled:opacity-50 ${
                  format === f
                    ? "bg-accent-glow text-accent"
                    : "bg-surface-2 text-foreground-muted hover:text-foreground"
                } ${locked ? "opacity-60" : ""}`}
              >
                {f}
                {locked && " 🔒"}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] text-subtle">{FORMAT_LABELS[format]}</span>
      </div>

      {exportError && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {exportError}
        </div>
      )}

      {/* Preview is just a look-before-you-export convenience — export makes its
          own independent request to /api/clip and doesn't need previewUrl, so a
          stuck or failed preview should never block it. */}
      {(loadingPreview || loadError) && (
        <p className="text-[10px] text-subtle">
          {loadError ? "Preview unavailable — you can still export below." : "Preview still loading — export doesn't need to wait for it."}
        </p>
      )}

      {/* Export */}
      <button
        onClick={exportClip}
        disabled={exporting}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none"
      >
        {exporting ? (
          <>
            <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
            Burning &amp; exporting…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export clip
          </>
        )}
      </button>
      </div>
      </div>

      {workspace && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-foreground">Timeline</h3>
            <span className="font-mono text-xs text-foreground-muted">
              {fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={splitAtPlayhead}
              disabled={!previewUrl || exporting || activeMediaIndex !== null || splitSegment(segments, segmentIndexAtSource(segments, currentTime), currentTime) === segments}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/50 disabled:opacity-40"
            >
              ✂ Split at playhead
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={(selectedMediaIndex === null && segments.length <= 1) || exporting}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-red-400/50 disabled:opacity-40"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={undoEdit}
              disabled={undoStack.length === 0 || exporting}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/50 disabled:opacity-40"
            >
              Undo
            </button>
            <span className="text-[11px] text-foreground-muted">Select a section on the video track to remove it.</span>
          </div>
          <div className="mb-3 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Your media</p>
                <p className="text-[11px] text-foreground-muted">Add a photo or video after the selected section. Photos start at 3 seconds; videos use up to 30 seconds.</p>
              </div>
              <label className="cursor-pointer rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20">
                {uploadingMedia ? "Importing…" : "+ Add image or video"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
                  className="sr-only" disabled={uploadingMedia || exporting}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void uploadMedia(file);
                  }} />
              </label>
            </div>
            {mediaError && <p role="alert" className="mt-2 text-xs text-red-400">{mediaError}</p>}
            {media.length > 0 && (
              <div className="mt-3 space-y-2">
                {media.map((item, index) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-2 text-xs">
                    <button type="button" className="max-w-44 truncate font-semibold text-foreground hover:text-accent"
                      onClick={() => {
                        const timelineItem = timelineItems.find((entry) => entry.mediaIndex === index);
                        if (timelineItem) seekOutput(timelineItem.start);
                      }}>{item.kind === "image" ? "▧" : "▶"} {item.name}</button>
                    <label className="ml-auto text-foreground-muted">Place
                      <select value={item.after} disabled={exporting}
                        onChange={(event) => applyMedia(media.map((entry, at) => at === index
                          ? { ...entry, after: Number(event.target.value) } : entry))}
                        className="ml-1 rounded border border-border bg-surface-2 px-2 py-1 text-foreground">
                        <option value={-1}>At start</option>
                        {segments.map((_, section) => <option key={section} value={section}>After section {section + 1}</option>)}
                      </select>
                    </label>
                    {item.kind === "image" ? (
                      <label className="text-foreground-muted">Seconds
                        <input type="number" min={0.1} max={30} step={0.1} value={item.duration}
                          disabled={exporting} onChange={(event) => {
                            const duration = Math.max(0.1, Math.min(30, Number(event.target.value) || 0.1));
                            const next = media.map((entry, at) => at === index ? { ...entry, duration } : entry);
                            try { parseMediaInserts(next, segments); applyMedia(next); setMediaError(null); }
                            catch (error) { setMediaError(error instanceof Error ? error.message : "Invalid duration."); }
                          }}
                          className="ml-1 w-16 rounded border border-border bg-surface-2 px-2 py-1 text-foreground" />
                      </label>
                    ) : <span className="font-mono text-foreground-muted">{item.duration.toFixed(1)}s</span>}
                    <button type="button" onClick={() => applyMedia(media.filter((_, at) => at !== index))}
                      disabled={exporting} className="rounded border border-border px-2 py-1 text-foreground-muted hover:text-red-400">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(editedDuration, 0.1)}
            step={0.1}
            value={Math.min(editedTime, editedDuration)}
            onChange={(e) => seekOutput(Number(e.target.value))}
            aria-label="Seek clip timeline"
            className="w-full accent-accent"
            disabled={!previewUrl}
          />
          <div className="mt-2 flex items-center gap-3 rounded-md bg-surface-2 px-3 py-3">
            <span className="w-16 shrink-0 text-[11px] font-semibold text-foreground-muted">Video</span>
            <div className="flex min-w-0 flex-1 gap-1">
              {timelineItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.id ?? item.sourceIndex}-${index}`}
                  type="button"
                  onClick={() => seekOutput(item.start)}
                  style={{ flex: `${item.end - item.start} 1 0%` }}
                  aria-label={item.kind === "source" ? `Select section ${item.sourceIndex! + 1}` : `Select imported ${item.kind}`}
                  aria-pressed={item.kind === "source" ? selectedMediaIndex === null && selectedSegment === item.sourceIndex
                    : selectedMediaIndex === item.mediaIndex}
                  className={`h-10 min-w-8 truncate rounded px-2 text-left text-[11px] font-semibold transition-colors ${
                    (item.kind === "source" ? selectedMediaIndex === null && selectedSegment === item.sourceIndex
                      : selectedMediaIndex === item.mediaIndex)
                      ? "bg-accent/25 border-2 border-accent text-foreground"
                      : item.kind === "source" ? "bg-accent/10 border border-accent/30 text-foreground-muted hover:border-accent/70"
                      : "bg-violet-500/20 border border-violet-400/40 text-violet-100 hover:border-violet-300"
                  }`}
                >
                  {item.kind === "source" ? `Section ${item.sourceIndex! + 1}` : item.kind === "image" ? "Image" : "Video"} · {fmtClipTime(item.end - item.start)}
                </button>
              ))}
            </div>
          </div>
          {segments[selectedSegment] && (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Trim section {selectedSegment + 1}</p>
              <ClipTrimControl
                originalStart={selectedSegment === 0 ? 0 : segments[selectedSegment - 1].end}
                originalEnd={selectedSegment === segments.length - 1 ? sourceDuration : segments[selectedSegment + 1].start}
                start={segments[selectedSegment].start}
                end={segments[selectedSegment].end}
                playhead={currentTime}
                disabled={!isPro || exporting}
                onChange={trimSelected}
              />
              {!isPro && <p className="mt-2 text-[10px] text-subtle">Trim editing is available with Pro.</p>}
            </div>
          )}
          {editedCaptionCues.length > 0 && (
            <div className="mt-1 flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-foreground-muted">Captions</span>
              <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
                {editedCaptionCues.map((cue, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => seekOutput(cue.t)}
                    style={{
                      left: `${(cue.t / editedDuration) * 100}%`,
                      width: `${Math.min(24, Math.max(5, 2 / editedDuration * 100))}%`,
                    }}
                    className="absolute top-0 h-8 truncate rounded bg-blue-500/20 border border-blue-400/30 px-2 text-left text-[10px] text-blue-100 hover:border-blue-300"
                    title={`${fmtClipTime(cue.t)} ${cue.text}`}
                  >
                    {cue.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}
    </div>
  );
}
