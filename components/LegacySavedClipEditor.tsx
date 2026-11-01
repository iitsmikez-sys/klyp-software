"use client";

/**
 * Inline editing panel for a saved clip (My Clips page). Mirrors the dashboard
 * analyze-flow export options: preview player, hook picker + hook text style,
 * caption style, format, and export. Hook options / caption words come from the
 * clips row (hooks/words columns, migration 003) — clips saved before that
 * migration can still be previewed and exported, just without those extras.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_LABELS, canUseExportFormat, resolveExportFormat, type CaptionStyle, type ExportFormat, type TimedWord } from "@/lib/clips";
import { buildCaptionCues, HOOK_STYLES, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import { drawWatermarkPreview } from "@/lib/watermark";
import { drawCaptionPreview } from "@/lib/caption-preview";
import { CAPTION_COLORS, CAPTION_HEX, CAPTION_POSITIONS, type CaptionColor, type CaptionPosition } from "@/lib/editor-captions";
import { useSparks } from "./SparksProvider";
import ProGateModal from "./ProGateModal";
import ClipTrimControl from "./LegacyClipTrimControl";
import type { EditorExportSettings } from "@/lib/editor-export-settings";
import EditorTimeline from "./LegacyEditorTimeline";
import Logo from "./Logo";
import workspaceStyles from "./EditorWorkspace.module.css";
import { archivedClipTiming } from "@/lib/clip-trim";
import type { SavedClip } from "@/lib/clip-ui";
import { processingFetch } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";
import { loadClipThumbnail, peekClipThumbnail } from "@/lib/clip-thumbnails";
import {
  deleteSegment, parseSegments, retimeWords, segmentIndexAtSource, splitSegment,
  timelineDuration, trimSegment, type EditSegment,
} from "@/lib/edit-segments";
import {
  buildEditorTimeline, firstOpeningInsertIndex, mediaAfterDelete, mediaAfterSplit, outputTimeForSource,
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
  WHITE_BOX: "White box — bold black text on white",
};

function fmtClipTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LegacySavedClipEditor({
  clip,
  workspace = false,
  draftId = clip.id,
  initialCaptionStyle = "BOLD",
  onSettingsChange,
  onKeepClip,
  savingClip = false,
  saveError, initialSettings, onExportStateChange,
}: { clip: SavedClip; workspace?: boolean; draftId?: string; initialCaptionStyle?: CaptionStyle;
  onSettingsChange?: (settings: EditorExportSettings) => void;
  onKeepClip?: () => void; savingClip?: boolean; saveError?: string | null;
  initialSettings?: EditorExportSettings;
  onExportStateChange?: (working: boolean, error?: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [transcriptOnly, setTranscriptOnly] = useState(false);
  const [leftTab, setLeftTab] = useState<"transcript" | "scene" | "media">("transcript");
  const [settingsTab, setSettingsTab] = useState<"edit" | "style">("edit");
  const [mobilePanel, setMobilePanel] = useState<"library" | "settings">("settings");
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const styleSectionRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [timelinePoster, setTimelinePoster] = useState<string | null>(() => peekClipThumbnail(clip));
  const [timelineFrames, setTimelineFrames] = useState<string[]>([]);
  const [sourcePeaks, setSourcePeaks] = useState<number[]>([]);
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
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(initialCaptionStyle);
  const [captionColor, setCaptionColor] = useState<CaptionColor>("DEFAULT");
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>("BOTTOM");
  const [captionWords, setCaptionWords] = useState<TimedWord[]>(Array.isArray(clip.words) ? clip.words : []);
  const [editingCaptionIndex, setEditingCaptionIndex] = useState<number | null>(null);
  const [editingHook, setEditingHook] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("9:16");
  const exportFormat = resolveExportFormat(format, isPro);
  const [sourceAspect, setSourceAspect] = useState(16 / 9);
  const previewAspect = exportFormat === "Original" ? sourceAspect
    : exportFormat === "16:9" ? 16 / 9 : exportFormat === "1:1" ? 1 : 9 / 16;
  const exportLock = useRef(false);
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
  const [redoStack, setRedoStack] = useState<Array<{
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
  const visibleOverlay = [...media].reverse().find((item) => item.placement === "overlay" &&
    editedTime >= item.at! && editedTime < item.at! + item.duration && item.url);
  const outputCaptionWords = useMemo(() => {
    if (!hasWords) return [];
    const words = media.length
      ? retimeWordsWithMedia(captionWords, clip.start_seconds, segments, media)
      : retimeWords(captionWords, clip.start_seconds, segments);
    return words;
  }, [captionWords, clip.start_seconds, hasWords, segments, media]);
  const liveCaptionCues = useMemo(() => buildCaptionCues(outputCaptionWords, 0, editedDuration * 1000,
    captionStyle === "KLYP" ? 1 : 4), [outputCaptionWords, editedDuration, captionStyle]);

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
    setRedoStack([]);
    const now = Date.now();
    const sameTrim = trim && lastTrimRef.current?.section === selected &&
      now - lastTrimRef.current.at < 800;
    if (!sameTrim) {
      setUndoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
    }
    lastTrimRef.current = trim ? { section: selected, at: now } : null;
    setSegments(next);
    const nextDuration = buildEditorTimeline(next, nextMedia).at(-1)?.end ?? timelineDuration(next);
    setMedia(nextMedia.map((item) => item.placement === "overlay"
      ? { ...item, at: Math.max(0, Math.min(item.at!, Math.max(0, nextDuration - item.duration))),
          duration: Math.min(item.duration, nextDuration) } : item));
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
    setRedoStack([]);
    setUndoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
    setMedia(next);
    const firstImported = firstOpeningInsertIndex(next);
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
    setRedoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
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

  const redoEdit = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    lastTrimRef.current = null;
    setUndoStack((history) => [...history.slice(-29), { segments, media, selected: selectedSegment, time: currentTime }]);
    setRedoStack((history) => history.slice(0, -1));
    setSegments(next.segments);
    setMedia(next.media);
    setActiveMediaIndex(null);
    setSelectedMediaIndex(null);
    setPlaying(false);
    setSelectedSegment(next.selected);
    activeSourceIndexRef.current = next.selected;
    if (videoRef.current) videoRef.current.currentTime = next.time + previewLeadSeconds;
    setCurrentTime(next.time);
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let live = true;
    loadClipThumbnail(clip).then((url) => { if (live) setTimelinePoster(url); }).catch(() => {});
    return () => { live = false; };
  }, [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!previewUrl || !workspace) return;
    let cancelled = false;
    const probe = document.createElement("video");
    probe.muted = true;
    probe.preload = "auto";
    probe.src = previewUrl;
    const capture = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          probe.onloadedmetadata = () => resolve();
          probe.onerror = () => reject(new Error("Preview frames unavailable"));
        });
        const count = Math.min(32, Math.max(8, Math.ceil(sourceDuration / 3)));
        const canvas = document.createElement("canvas");
        canvas.width = 112; canvas.height = 64;
        const context = canvas.getContext("2d");
        if (!context) return;
        const frames: string[] = [];
        for (let index = 0; index < count && !cancelled; index++) {
          const target = Math.min(Math.max(0.05, probe.duration - 0.05),
            Math.max(0.05, previewLeadSeconds + index / count * sourceDuration));
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 1200);
            probe.onseeked = () => { clearTimeout(timeout); resolve(); };
            probe.currentTime = target;
          });
          if (probe.readyState < 2) continue;
          const scale = Math.max(canvas.width / probe.videoWidth, canvas.height / probe.videoHeight);
          const width = probe.videoWidth * scale;
          const height = probe.videoHeight * scale;
          context.drawImage(probe, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
          frames.push(canvas.toDataURL("image/jpeg", 0.66));
        }
        if (!cancelled) setTimelineFrames(frames);
      } catch { if (!cancelled) setTimelineFrames([]); }
    };
    void capture();
    return () => { cancelled = true; probe.pause(); probe.removeAttribute("src"); probe.load(); };
  }, [previewUrl, previewLeadSeconds, sourceDuration, workspace]);

  useEffect(() => {
    if (!previewUrl || !workspace) return;
    let live = true;
    let context: AudioContext | null = null;
    (async () => {
      try {
        const bytes = await (await fetch(previewUrl)).arrayBuffer();
        context = new AudioContext();
        const audio = await context.decodeAudioData(bytes);
        const channel = audio.getChannelData(0);
        const peaks = Array.from({ length: 240 }, (_, index) => {
          const from = Math.floor(index / 240 * channel.length);
          const to = Math.floor((index + 1) / 240 * channel.length);
          let peak = 0;
          for (let sample = from; sample < to; sample += Math.max(1, Math.floor((to - from) / 80))) {
            peak = Math.max(peak, Math.abs(channel[sample]));
          }
          return peak;
        });
        if (live) setSourcePeaks(peaks);
      } catch { if (live) setSourcePeaks([]); }
      finally { void context?.close().catch(() => {}); }
    })();
    return () => { live = false; };
  }, [previewUrl, workspace]);

  const uploadMedia = async (file: File) => {
    setMediaError(null);
    if (!clip.id) return setMediaError("Keep this clip before adding media.");
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
      const overlay = result.kind === "image" && editedDuration >= 0.1;
      const duration = overlay ? Math.min(result.duration, editedDuration) : result.duration;
      const next = [...media, { id: result.id, kind: result.kind, duration,
        after: selectedSegment, ...(overlay ? { placement: "overlay", at: Math.min(editedTime, editedDuration - duration) } : {}),
        name: file.name, url: result.url } as EditorMedia];
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
      let raw: string | null = null;
      try { raw = localStorage.getItem(`klyp-editor-${draftId}`); } catch { /* Use the in-memory draft below. */ }
      if (!raw && initialSettings) raw = JSON.stringify({
        hook: initialSettings.hook ?? null, hookStyle: initialSettings.hook_style,
        captionStyle: initialSettings.style, captionColor: initialSettings.caption_color, captionPosition: initialSettings.caption_position,
        captionEdits: initialSettings.caption_edits?.map(({ text }) => text), format: initialSettings.aspect_ratio,
        segments: initialSettings.segments, media: initialSettings.media,
      });
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
          const firstImported = firstOpeningInsertIndex(named);
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
      localStorage.setItem(`klyp-editor-${draftId}`, JSON.stringify({
        hook: selectedHook, hookStyle, captionStyle, captionColor, captionPosition,
        captionEdits: captionWords.map((word) => word.text), format, segments,
        media: media.map(({ id, kind, after, duration, placement, at, name }) => ({ id, kind, after, duration, placement, at, name })),
      }));
    } catch { /* Storage can be unavailable; editing and export still work. */ }
  }, [clip.id, draftReady, selectedHook, hookStyle, captionStyle, captionColor, captionPosition, captionWords, format, segments, media]);

  useEffect(() => {
    if (!draftReady) return;
    onSettingsChange?.({ style: hasWords ? captionStyle : undefined,
      hook: selectedHook ?? undefined, hook_style: hookStyle, aspect_ratio: exportFormat,
      caption_color: captionColor, caption_position: captionPosition,
      caption_edits: hasWords ? captionWords.map(({ text }) => ({ text })) : undefined,
      segments, media: media.map(({ id, kind, after, duration, placement, at }) => ({ id, kind, after, duration, placement, at })),
    });
  }, [draftReady, onSettingsChange, hasWords, captionStyle, selectedHook, hookStyle, exportFormat, captionColor, captionPosition, captionWords, segments, media]);


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
      if (!isPro) {
        const output = exportFormat === "9:16" ? [1080, 1920] : exportFormat === "1:1" ? [1080, 1080]
          : exportFormat === "16:9" ? [1920, 1080] : [video.videoWidth || 1080, video.videoHeight || 1920];
        drawWatermarkPreview(ctx, editedTimeRef.current, canvas.width, canvas.height, output[0], output[1]);
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [previewUrl, selectedHook, hookStyle, liveCaptionCues, captionStyle, captionColor, captionPosition, isPro, exportFormat]);

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
      body: JSON.stringify({ legacy_editor: true,
        clip_id: clip.id,
        url: clip.url,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        crop: false,
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
    if (exportLock.current) return;
    exportLock.current = true;
    onExportStateChange?.(true);
    let failure: string | undefined;
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
        body: JSON.stringify({ legacy_editor: true,
          clip_id: clip.id,
          url: clip.url,
          start_seconds: clip.start_seconds,
          end_seconds: clip.end_seconds,
          segments,
          media: media.map(({ id, kind, after, duration, placement, at }) => ({ id, kind, after, duration, placement, at })),
          title: clip.title,
          style: hasWords ? captionStyle : undefined,
          words: hasWords ? clip.words : undefined,
          caption_edits: hasWords ? captionWords.map((word) => ({ text: word.text })) : undefined,
          caption_color: captionColor,
          caption_position: captionPosition,
          hook: selectedHook ?? undefined,
          hook_style: hookStyle,
          handle: getStoredHandle(),
          aspect_ratio: exportFormat,
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
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      failure = controller.signal.aborted
        ? "Export timed out after 10 minutes. Try again in a bit."
        : err instanceof Error ? err.message : "Export failed.";
      setExportError(failure);
    } finally {
      clearTimeout(timeout);
      exportLock.current = false;
      setExporting(false);
      onExportStateChange?.(false, failure);
    }
  };

  return (
    <div data-mobile-panel={mobilePanel} className={workspace ? `${workspaceStyles.workspace} xl:h-full xl:flex xl:flex-col bg-[#080f13]` : "mt-4 pt-4 border-t border-border"} onClick={(e) => e.stopPropagation()}>
      {workspace && (
        <div className={workspaceStyles.header}>
          <Logo size="lg" />
          <span className="hidden sm:block h-7 w-px bg-[#2b3941]" />
          <span className="min-w-0 truncate text-base font-semibold text-foreground" title={clip.title}>{clip.title}</span>
          <span className="hidden md:block h-7 w-px bg-[#2b3941]" />
          <span className="hidden md:block shrink-0 text-xs text-foreground-muted"><span className="text-accent">☁</span> &nbsp;Saved on this device</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" onClick={undoEdit} disabled={undoStack.length === 0 || exporting}
              title="Undo" aria-label="Undo" className="hidden sm:inline rounded px-2 text-xl text-foreground-muted hover:text-white disabled:opacity-40">↶</button>
            <button type="button" onClick={redoEdit} disabled={redoStack.length === 0 || exporting}
              title="Redo" aria-label="Redo" className="hidden sm:inline rounded px-2 text-xl text-foreground-muted hover:text-white disabled:opacity-40">↷</button>
            <span className="hidden sm:inline rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted">{exportFormat}</span>
            <button type="button" onClick={exportClip} disabled={exporting}
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-bold text-background hover:bg-accent-dim disabled:opacity-50">
              {exporting ? "Exporting…" : "↑ Export"}
            </button>
          </div>
        </div>
      )}
      <div className={workspace
        ? workspaceStyles.grid
        : "grid grid-cols-1 lg:grid-cols-2 gap-6 items-start"}>

      {/* ── Scene analysis (left): description + transcript with timestamps ── */}
      {workspace && <div className={workspaceStyles.mobileTabs} aria-label="Editor panels">
        <button type="button" aria-pressed={mobilePanel === "library"} onClick={() => setMobilePanel("library")}>Transcript & media</button>
        <button type="button" aria-pressed={mobilePanel === "settings"} onClick={() => setMobilePanel("settings")}>Clip settings</button>
      </div>}
      <div className={workspace
        ? `${workspaceStyles.library} order-2 xl:order-1 min-w-0 min-h-0 flex border-r border-[#24323a] bg-[#0b151b]`
        : "space-y-3"}>
        {workspace && <nav aria-label="Editor sections" className="hidden xl:flex w-[64px] shrink-0 flex-col items-stretch gap-1 border-r border-[#20343e] bg-[#061119] pt-2">
          {(["transcript", "media", "scene"] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setLeftTab(tab)} aria-current={leftTab === tab ? "page" : undefined}
              className={`mx-1 flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors ${leftTab === tab ? "border-l-4 border-accent bg-[#073d34] text-white" : "text-foreground-muted hover:bg-white/5 hover:text-white"}`}>
              {tab === "transcript" ? <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5V7h4M9 11h6M9 15h6M9 19h4"/></svg>
                : tab === "media" ? <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>
                : <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 19h16M6 16l3-5 3 2 4-7 2 3"/><circle cx="9" cy="11" r="1"/></svg>}
              {tab === "scene" ? "Scene" : tab === "media" ? "Media" : "Transcript"}
            </button>
          ))}
        </nav>}
        <div className={workspace ? "flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4" : "space-y-3"}>
        {workspace && (
          <div className="flex gap-4 border-b border-[#263943] pb-2 xl:hidden">
            {(["transcript", "scene", "media"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setLeftTab(tab)}
                className={`pb-1 text-xs font-semibold capitalize ${leftTab === tab ? "border-b-2 border-accent text-white" : "text-foreground-muted hover:text-white"}`}>
                {tab === "scene" ? "Scene analysis" : tab}
              </button>
            ))}
          </div>
        )}
        {!workspace && <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">Transcript / Scene Analysis</p>
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
        </div>}

        {workspace && leftTab === "transcript" && (
          <div className="flex items-center gap-4 border-b border-[#263943] pb-3">
            <h2 className="hidden shrink-0 border-b-2 border-accent pb-2 text-base font-semibold text-white xl:block">Transcript</h2>
            <input type="search" value={transcriptSearch} onChange={(event) => setTranscriptSearch(event.target.value)}
              placeholder="⌕  Search transcript…" aria-label="Search transcript"
              className="min-w-0 flex-1 rounded-lg border border-[#263943] bg-[#0b1117] px-3 py-2 text-xs text-foreground placeholder:text-subtle focus:border-accent focus:outline-none" />
          </div>
        )}

        {workspace && leftTab !== "transcript" && <h2 className="hidden xl:block border-b border-[#263943] pb-3 text-base font-semibold text-white">{leftTab === "media" ? "Media" : "Scene analysis"}</h2>}

        {((workspace && leftTab === "scene") || (!workspace && !transcriptOnly)) && (
          <div className="px-3.5 py-3 rounded-lg bg-surface-2 border border-border space-y-1.5">
            <p className="text-[10px] font-bold font-syne tracking-wide text-accent">{clip.clip_type}</p>
            {clip.reason && <p className="text-xs text-foreground-muted leading-relaxed">{clip.reason}</p>}
            {clip.caption && <p className="text-xs text-subtle leading-relaxed italic">{clip.caption}</p>}
          </div>
        )}

        {(!workspace || leftTab === "transcript") && (transcriptCues.length > 0 ? (
          <div className={workspace ? "min-h-0 flex-1 overflow-y-auto scrollbar-thin" : "max-h-96 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-surface-2/50 divide-y divide-border"}>
            {transcriptCues.filter((cue) => cue.text.toLowerCase().includes(transcriptSearch.toLowerCase())).map((cue) => (
              <button
                key={cue.t}
                type="button"
                onClick={() => seekTo(cue.t)}
                disabled={segmentIndexAtSource(segments, cue.t) < 0}
                className={`w-full flex items-start gap-3 px-3.5 py-2 text-left hover:bg-surface-2 focus:outline-none focus:bg-surface-2 disabled:opacity-35 disabled:line-through disabled:cursor-not-allowed ${workspace && cue.t <= currentTime && (transcriptCues.find((next) => next.t > cue.t)?.t ?? Infinity) > currentTime ? "rounded-md bg-accent/10 text-accent" : ""}`}
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
        ))}

        {workspace && leftTab === "media" && (
          <div className="space-y-3">
            <p className="text-xs text-foreground-muted">Add your own photo or video to the timeline.</p>
            {uploadingMedia && <p className="text-xs text-accent">Importing media…</p>}
            {mediaError && <p role="alert" className="text-xs text-red-400">{mediaError}</p>}
            {media.map((item, index) => (
              <button type="button" key={item.id} onClick={() => {
                const entry = timelineItems.find((part) => part.mediaIndex === index);
                if (item.placement === "overlay") { seekOutput(item.at!); setSelectedMediaIndex(index); }
                else if (entry) seekOutput(entry.start);
              }}
                className="flex w-full items-center gap-2 rounded-lg border border-[#30424c] bg-[#101c23] p-2 text-left text-xs text-foreground hover:border-accent/60">
                {item.kind === "image" && item.url ? <img src={item.url} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded bg-violet-500/20">▶</span>}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="font-mono text-[10px] text-foreground-muted">{item.duration.toFixed(1)}s</span>
              </button>
            ))}
          </div>
        )}
        {workspace && <div className="mt-auto grid grid-cols-2 gap-3 border-t border-[#263943] pt-3">
          {([{"label":"Add photo","accept":"image/jpeg,image/png,image/webp,image/heic,image/heif","icon":"▧"},
            {"label":"Add video","accept":"video/mp4,video/quicktime,video/webm","icon":"▣"}]).map(({ label, accept, icon }) => (
            <label key={label} className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#30424c] bg-[#0d1a21] text-xs font-semibold text-foreground hover:border-accent/60">
              <span className="text-lg">{icon}</span>{label}
              <input type="file" accept={accept} className="sr-only" disabled={!clip.id || uploadingMedia || exporting}
                onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadMedia(file); }} />
            </label>
          ))}
        </div>}
        </div>
      </div>

      {/* ── Vertical preview (centre) ── */}
      <div className={workspace
        ? `${workspaceStyles.preview} order-1 xl:order-2 min-w-0 min-h-0 bg-[#050d12] flex flex-col justify-between`
        : "order-1 lg:order-2 min-w-0 rounded-xl border border-border bg-background p-3"}>
        {!workspace && <p className="mb-3 text-sm font-semibold text-foreground">Preview</p>}
        <div className={workspace ? workspaceStyles.stage : undefined}>
        <div ref={previewFrameRef} className={`relative bg-black overflow-hidden mx-auto ${workspace ? workspaceStyles.frame : ""}`}
          style={{ aspectRatio: previewAspect, "--preview-aspect": previewAspect, maxHeight: workspace ? undefined : 380 } as React.CSSProperties}>
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
              className="w-full h-full object-cover cursor-pointer"
              playsInline
              onClick={togglePlayback}
              muted={muted}
              onTimeUpdate={(e) => onPreviewTimeUpdate(e.currentTarget)}
              onLoadedMetadata={(e) => {
                setPreviewDuration(e.currentTarget.duration || previewDuration);
                if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
                  setSourceAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
                }
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
            {visibleOverlay && (
              <img src={visibleOverlay.url} alt={visibleOverlay.name}
                className="absolute inset-0 h-full w-full object-cover pointer-events-none" />
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
        </div>
        {workspace ? <div className={`${workspaceStyles.playback} flex h-[58px] items-center justify-between gap-2 border-t border-[#22343c] bg-[#07141c] px-4 text-xs text-foreground-muted`}>
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setMuted((value) => !value)} disabled={!previewUrl}
              className="rounded border border-[#29424c] px-2 py-1.5 text-white hover:border-accent disabled:opacity-40"
              aria-label={muted ? "Unmute preview" : "Mute preview"}>{muted ? "◌" : "◖))"}</button>
            <span className="whitespace-nowrap font-mono text-white">{fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}</span>
          </div>
          <div className="flex items-center gap-3 text-white">
            <button type="button" onClick={() => seekOutput(Math.max(0, editedTime - 5))} disabled={!previewUrl}
              aria-label="Back five seconds" className="px-1 text-lg hover:text-accent disabled:opacity-40">⏮</button>
            <button type="button" onClick={togglePlayback} disabled={!previewUrl}
              aria-label={playing ? "Pause preview" : "Play preview"}
              className="min-w-10 px-1 text-3xl leading-none hover:text-accent disabled:opacity-40">{playing ? "Ⅱ" : "▶"}</button>
            <button type="button" onClick={() => seekOutput(Math.min(editedDuration, editedTime + 5))} disabled={!previewUrl}
              aria-label="Forward five seconds" className="px-1 text-lg hover:text-accent disabled:opacity-40">⏭</button>
          </div>
          <div className="flex items-center gap-2">
            <select value={exportFormat} onChange={(event) => {
              const next = event.target.value as ExportFormat;
              if (!canUseExportFormat(next, isPro)) setProGateOpen(true);
              else setFormat(next);
            }} aria-label="Export format" className="rounded border border-[#29424c] bg-[#07141c] px-2 py-1.5 text-white">
              {EXPORT_FORMATS.map((option) => <option key={option} value={option}>{option}{!canUseExportFormat(option, isPro) ? " 🔒" : ""}</option>)}
            </select>
            <button type="button" onClick={() => void previewFrameRef.current?.parentElement?.requestFullscreen?.()}
              aria-label="Full screen preview" className="rounded border border-[#29424c] px-2 py-1.5 text-white hover:border-accent">⛶</button>
          </div>
        </div> : <div className="mt-2 flex items-center justify-center gap-4 text-xs text-foreground-muted">
          <button type="button" onClick={togglePlayback} disabled={!previewUrl} className="rounded-md border border-border px-3 py-1 text-foreground hover:border-accent/50 disabled:opacity-40">{playing ? "Pause" : "Play"}</button>
          <span className="font-mono">{fmtClipTime(editedTime)} / {fmtClipTime(editedDuration)}</span>
          <button type="button" onClick={() => setMuted((value) => !value)} disabled={!previewUrl} className="rounded-md border border-border px-2 py-1 text-foreground hover:border-accent/50 disabled:opacity-40" aria-label={muted ? "Unmute preview" : "Mute preview"}>{muted ? "Unmute" : "Mute"}</button>
        </div>}
      {!workspace && <p className="text-[10px] text-subtle text-center mt-1">
        Click the hook or captions in the preview to edit their text.
      </p>}
      </div>

      {/* ── Editing controls (right) ── */}
      <div ref={settingsPanelRef} className={workspace
        ? `${workspaceStyles.settings} order-3 min-w-0 min-h-0 space-y-4 xl:overflow-y-auto border-l border-[#24323a] bg-[#08141b] p-4 pb-8`
        : "order-3 min-w-0 space-y-4 rounded-xl border border-border bg-background p-4"}>
      <div className={workspace ? "sticky -top-4 z-20 -mx-4 -mt-4 flex border-b border-[#29414a] bg-[#08141b]" : "flex items-center justify-between gap-2"}>
        {workspace ? <>
          <button type="button" onClick={() => { setSettingsTab("edit"); settingsPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
            aria-current={settingsTab === "edit" ? "page" : undefined}
            className={`w-1/2 border-b-[3px] py-3 text-sm font-semibold ${settingsTab === "edit" ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-white"}`}>Edit</button>
          <button type="button" onClick={() => { setSettingsTab("style"); styleSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }}
            aria-current={settingsTab === "style" ? "page" : undefined}
            className={`w-1/2 border-b-[3px] py-3 text-sm font-semibold ${settingsTab === "style" ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-white"}`}>Style</button>
        </> : <h3 className="text-sm font-semibold text-foreground">Clip settings</h3>}
        {!workspace && <span className="text-[10px] text-subtle">Saved on this device</span>}
      </div>

      {!clip.id && onKeepClip && <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
        <p className="text-foreground-muted">Keep this clip to add photos or videos.</p>
        {saveError && <p role="alert" className="mt-2 text-red-400">{saveError}</p>}
        <button type="button" disabled={savingClip || exporting} onClick={onKeepClip} className="mt-2 rounded border border-accent/40 px-3 py-2 font-semibold text-accent disabled:opacity-50">{savingClip ? "Saving…" : "Keep clip to add media"}</button>
      </div>}
      {!isPro && <p className="text-xs text-foreground-muted">Free exports include an animated Klyp watermark. Original-format preview sizing is approximate.</p>}
      {/* Hook options */}
      <div>
        <p className={`${workspace ? "text-sm font-semibold text-white" : "text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted"} mb-2`}>
          {workspace ? "Hook Text" : "Hook"}{" "}
          <span className="font-normal normal-case tracking-normal text-subtle">
            — shown on screen for the first 3s
          </span>
        </p>
        {workspace && <input
          type="text" value={selectedHook ?? ""} maxLength={80} disabled={exporting}
          onChange={(event) => setSelectedHook(event.target.value ? event.target.value.slice(0, 80) : null)}
          placeholder="Type a hook or choose an AI suggestion"
          className="mb-3 w-full rounded-lg border border-[#30424c] bg-[#0a1117] px-3 py-2 text-xs text-foreground placeholder:text-subtle focus:border-accent focus:outline-none" />}
        {workspace && <p className="mb-2 text-xs font-semibold text-foreground-muted">✧ AI suggestions</p>}
        {hooks.length > 0 ? (
          <div className={workspace ? "flex flex-wrap gap-1.5" : "flex flex-col gap-1.5"}>
            {hooks.map((hookText) => {
              const selected = selectedHook === hookText;
              return (
                <button
                  key={hookText}
                  onClick={() => setSelectedHook(selected ? null : hookText)}
                  disabled={exporting}
                  className={`text-left px-3 py-1.5 border transition-colors disabled:opacity-50 ${workspace ? "rounded-full text-[10px]" : "rounded-lg text-xs"} ${
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
        {!workspace && <input
          type="text"
          value={selectedHook ?? ""}
          onChange={(e) => setSelectedHook(e.target.value.length > 0 ? e.target.value.slice(0, 80) : null)}
          placeholder="Type a custom hook, or pick one above"
          maxLength={80}
          disabled={exporting}
          className="mt-1.5 w-full px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs text-foreground placeholder:text-subtle focus:outline-none focus:border-accent/50 disabled:opacity-50"
        />}
        {!workspace && <p className="text-[10px] text-subtle mt-1">
          Burned on screen in ALL CAPS for the first 3s — clear the field to export without a hook.
        </p>}
      </div>

      {/* Hook text style */}
      {selectedHook && (
        <div ref={styleSectionRef}>
          <p className={`${workspace ? "text-sm font-semibold text-white" : "text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted"} mb-2`}>
            Hook Text Style
          </p>
          <div className={workspace ? "grid grid-cols-5 gap-1.5" : "flex flex-wrap gap-1.5"}>
            {HOOK_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setHookStyle(s)}
                disabled={exporting}
                title={HOOK_STYLE_LABELS[s]}
                className={`${workspace ? "min-w-0 rounded-lg px-1 py-2 text-center" : "px-2.5 py-1.5 rounded-md"} border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  hookStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {workspace && <span className={`block text-lg leading-none mb-1 ${s === "YELLOW" ? "text-yellow-300" : s === "NEON" ? "text-accent" : "text-white"}`}>Aa</span>}
                <span className={workspace ? "text-[9px] capitalize tracking-normal" : ""}>{workspace ? s.toLowerCase() : s}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-subtle mt-1.5">{HOOK_STYLE_LABELS[hookStyle]}</p>
        </div>
      )}

      {/* Caption style */}
      <div ref={selectedHook ? undefined : styleSectionRef}>
        <p className={`${workspace ? "text-sm font-semibold text-white" : "text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted"} mb-2`}>
          Caption Style
        </p>
        {hasWords ? (
          <div className={workspace ? "grid grid-cols-3 gap-2" : "flex gap-2 overflow-x-auto pb-2"} aria-label="Caption styles">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setCaptionStyle(s)}
                disabled={exporting}
                className={`${workspace ? "min-w-0 rounded-lg py-2.5" : "shrink-0 min-w-[70px] px-2 py-1.5 rounded-md"} border text-[11px] font-bold font-syne tracking-wide transition-colors disabled:opacity-50 ${
                  captionStyle === s
                    ? "bg-accent-glow border-accent/50 text-accent"
                    : "border-border text-foreground-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {workspace && <span className="block text-xl leading-none mb-1">Aa</span>}
                <span className={workspace ? "text-[10px] capitalize tracking-normal" : ""}>{s === "KLYP" ? workspace ? "Klyp" : "⚡ KLYP" : workspace ? s.toLowerCase() : s}</span>
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
          {captionStyle === "COMIC" || captionStyle === "KEYWORD" ? <p className="text-xs text-foreground-muted">This template uses its own yellow or green palette.</p> : <div>
            <p className={`${workspace ? "text-sm font-semibold text-white" : "text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted"} mb-2`}>Caption color</p>
            <div className={workspace ? "grid grid-cols-5 gap-1.5" : "flex flex-wrap gap-1.5"}>
              {CAPTION_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setCaptionColor(color)} disabled={exporting}
                  className={`rounded-lg border px-1 py-2 text-[9px] font-bold ${captionColor === color ? "border-accent text-accent bg-accent-glow" : "border-border text-foreground-muted"}`}>
                  <span className="mx-auto mb-1 block h-5 w-5 rounded-full border border-black/30" style={{ background: color === "DEFAULT" ? "#677589" : CAPTION_HEX[color] }} />
                  {color === "DEFAULT" ? "Default" : color[0] + color.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>}
          <div>
            <p className={`${workspace ? "text-sm font-semibold text-white" : "text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted"} mb-2`}>Caption position</p>
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
      {!workspace && <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
          Format
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {EXPORT_FORMATS.map((f) => {
            const locked = !canUseExportFormat(f, isPro);
            return (
              <button
                key={f}
                onClick={() => (locked ? setProGateOpen(true) : setFormat(f))}
                disabled={exporting}
                title={locked ? "Square and wide formats require Pro" : FORMAT_LABELS[f]}
                className={`px-2.5 py-1.5 text-[11px] font-bold font-syne transition-colors disabled:opacity-50 ${
                  exportFormat === f
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
        <span className="text-[10px] text-subtle">{FORMAT_LABELS[exportFormat]}</span>
      </div>}

      {workspace && <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
      {workspace && segments[selectedSegment] && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
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

      {workspace && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs font-semibold text-foreground">Your media</p>
          <p className="mt-1 text-[11px] text-foreground-muted">Photos appear over the video at the playhead. Videos are inserted after the selected section.</p>
          <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20">
            {uploadingMedia ? "Importing…" : "+ Add image or video"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
              className="sr-only" disabled={!clip.id || uploadingMedia || exporting}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadMedia(file);
              }} />
          </label>
          {mediaError && <p role="alert" className="mt-2 text-xs text-red-400">{mediaError}</p>}
          {media.length > 0 && (
            <div className="mt-3 space-y-2">
              {media.map((item, index) => (
                <div key={item.id} className="space-y-2 rounded-lg border border-border bg-background p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-foreground hover:text-accent"
                      onClick={() => {
                        const timelineItem = timelineItems.find((entry) => entry.mediaIndex === index);
                        if (item.placement === "overlay") { seekOutput(item.at!); setSelectedMediaIndex(index); }
                        else if (timelineItem) seekOutput(timelineItem.start);
                      }}>{item.kind === "image" ? "▧" : "▶"} {item.name}</button>
                    <button type="button" onClick={() => applyMedia(media.filter((_, at) => at !== index))}
                      disabled={exporting} className="rounded border border-border px-2 py-1 text-foreground-muted hover:text-red-400">Remove</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.placement === "overlay" ? (
                      <label className="text-foreground-muted">Start
                        <input type="number" min={0} max={Math.max(0, editedDuration - item.duration)} step={0.1}
                          value={item.at} disabled={exporting}
                          onChange={(event) => applyMedia(media.map((entry, at) => at === index
                            ? { ...entry, at: Math.max(0, Math.min(editedDuration - entry.duration, Number(event.target.value) || 0)) } : entry))}
                          className="ml-1 w-16 rounded border border-border bg-surface-2 px-2 py-1 text-foreground" /> s
                      </label>
                    ) : <label className="text-foreground-muted">Place
                      <select value={item.after} disabled={exporting}
                        onChange={(event) => applyMedia(media.map((entry, at) => at === index
                          ? { ...entry, after: Number(event.target.value) } : entry))}
                        className="ml-1 rounded border border-border bg-surface-2 px-2 py-1 text-foreground">
                        <option value={-1}>At start</option>
                        {segments.map((_, section) => <option key={section} value={section}>After section {section + 1}</option>)}
                      </select>
                    </label>}
                    {item.kind === "image" ? (
                      <label className="text-foreground-muted">Seconds
                        <input type="number" min={0.1} max={30} step={0.1} value={item.duration}
                          disabled={exporting} onChange={(event) => {
                            const duration = Math.max(0.1, Math.min(30, item.placement === "overlay" ? editedDuration - item.at! : 30, Number(event.target.value) || 0.1));
                            const next = media.map((entry, at) => at === index ? { ...entry, duration } : entry);
                            try { parseMediaInserts(next, segments); applyMedia(next); setMediaError(null); }
                            catch (error) { setMediaError(error instanceof Error ? error.message : "Invalid duration."); }
                          }}
                          className="ml-1 w-16 rounded border border-border bg-surface-2 px-2 py-1 text-foreground" />
                      </label>
                    ) : <span className="font-mono text-foreground-muted">{item.duration.toFixed(1)}s</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>}

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
      {!workspace && <button
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
      </button>}
      </div>
      </div>

      {workspace && <EditorTimeline
        items={timelineItems} media={media} cues={liveCaptionCues} peaks={sourcePeaks}
        frames={timelineFrames} poster={timelinePoster} sourceDuration={sourceDuration}
        previewDuration={previewDuration} previewLeadSeconds={previewLeadSeconds}
        duration={editedDuration} time={editedTime} selectedSegment={selectedSegment}
        selectedMediaIndex={selectedMediaIndex} hook={selectedHook}
        ready={Boolean(previewUrl)} exporting={exporting}
        canSplit={Boolean(previewUrl) && activeMediaIndex === null &&
          splitSegment(segments, segmentIndexAtSource(segments, currentTime), currentTime) !== segments}
        canDelete={selectedMediaIndex !== null || segments.length > 1}
        canUndo={undoStack.length > 0} canRedo={redoStack.length > 0}
        onSeek={(seconds) => seekOutput(seconds)} onSplit={splitAtPlayhead} onDelete={removeSelected}
        onUndo={undoEdit} onRedo={redoEdit}
        onSelectMedia={(index) => {
          const item = media[index];
          if (item.placement === "overlay") { seekOutput(item.at!); setSelectedMediaIndex(index); }
          else { const entry = timelineItems.find((part) => part.mediaIndex === index); if (entry) seekOutput(entry.start); }
        }}
        onMoveOverlay={(index, at) => {
          if (exporting) return;
          applyMedia(media.map((entry, current) => current === index ? { ...entry, at } : entry));
          setSelectedMediaIndex(index);
        }}
        onResizeOverlay={(index, duration) => {
          if (exporting) return;
          const entry = media[index];
          applyMedia(media.map((item, current) => current === index
            ? { ...item, duration: Math.max(0.1, Math.min(30, editedDuration - entry.at!, duration)) } : item));
          setSelectedMediaIndex(index);
        }}
        onTrimSource={(index, edge, delta) => {
          if (exporting) return;
          if (!isPro) { setProGateOpen(true); return; }
          const entry = segments[index];
          if (!entry) return;
          const next = trimSegment(segments, index, edge,
            (edge === "start" ? entry.start : entry.end) + delta, sourceDuration);
          applySegments(next, index, true);
        }}
      />}
      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}
    </div>
  );
}
