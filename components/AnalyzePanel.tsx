"use client";

import { useState, useEffect, useRef, useMemo, useCallback, FormEvent } from "react";
import type { AnalyzeEvent, AnalyzeStage, ClipWithWords, CaptionStyle, ExportFormat, ContentType } from "@/lib/clips";
import { CAPTION_STYLES, CONTENT_TYPES, CONTENT_TYPE_LABELS, DEFAULT_CONTENT_TYPE, resolveExportFormat } from "@/lib/clips";
import {
  MIN_ANALYZE_COST,
  CLIP_COUNT_COST,
  DEFAULT_CLIP_COUNT,
  MAX_CLIP_COUNT,
  type ClipCount,
} from "@/lib/sparks";
import { useSparks } from "./SparksProvider";
import { SparkIcon } from "./SparksBalance";
import ClipPreviewModal from "./ResultsClipPreviewModal";
import FoundClipCard from "./FoundClipCard";
import { platformName, type SavedClip } from "@/lib/clip-ui";
import type { EditorExportSettings } from "@/lib/editor-export-settings";
import { resultsChargeMessage } from "@/lib/results-summary";
import resultsStyles from "./ClipResults.module.css";
import ProGateModal from "./ProGateModal";
import { createClient } from "@/lib/supabase/client";
import { processingFetch, processingUrl, processingAuthToken } from "@/lib/processing-api";
import { getStoredHandle } from "@/lib/streamer-handle";
import { isYouTubeBotBlockError } from "@/lib/analyze-errors";
import { uploadFileToR2 } from "@/lib/r2-browser-upload";

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

// Keep older clip counts valid for existing jobs, but offer a focused set for new runs.
const CLIP_COUNT_CHOICES = [3, 5, 7, 10] as const satisfies readonly ClipCount[];

/** Export can include a first-time source download + full-quality burn — generous but finite. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;

/** Backoff before retrying the initial /api/analyze connection after a network-level failure. */
const ANALYZE_RETRY_DELAYS_MS = [1000, 2000];

/** Pipeline steps shown in the full-screen progress overlay. */
const PIPELINE_STEPS: { key: AnalyzeStage | "done"; label: string }[] = [
  { key: "download", label: "Downloading audio…" },
  { key: "transcribe", label: "Transcribing audio…" },
  { key: "analyze", label: "Finding viral moments…" },
  { key: "done", label: "Done! Here are your clips" },
];

type StepStatus = "pending" | "running" | "done";
type StageStates = Record<AnalyzeStage | "done", StepStatus>;

const INITIAL_STAGES: StageStates = {
  download: "pending",
  transcribe: "pending",
  analyze: "pending",
  done: "pending",
};

function fmtTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB — keep in sync with /api/upload
const UPLOAD_EXT_PATTERN = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  durationSeconds: number;
  sparks: number;
};

export default function AnalyzePanel() {
  const [url, setUrl] = useState("");
  const [analyzedUrl, setAnalyzedUrl] = useState(""); // URL snapshot the clips belong to
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<StageStates>(INITIAL_STAGES);
  const [etaRemaining, setEtaRemaining] = useState<number | null>(null);
  /** When the current stage started, so we can show real elapsed time instead
   *  of a countdown that just sits at "almost done…" once its estimate runs out. */
  const [stageStartedAt, setStageStartedAt] = useState<number | null>(null);
  const [stageElapsed, setStageElapsed] = useState(0);
  /** Re-arms the no-progress watchdog. Called ONLY on real progress events —
   *  never on heartbeats, which is the whole point (see the stream loop). */
  const rearmProgressWatchdog = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipWithWords[] | null>(null);
  const [clipStyles, setClipStyles] = useState<Record<number, CaptionStyle>>({});
  const [clipHooks, setClipHooks] = useState<Record<number, string | null>>({});
  const [clipFormats, setClipFormats] = useState<Record<number, ExportFormat>>({});
  // Library decision per clip — nothing is saved to Supabase until the user keeps it.
  const [clipStatus, setClipStatus] = useState<Record<number, "unsaved" | "kept" | "discarded">>({});
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadElapsed, setDownloadElapsed] = useState(0);
  /** Rendered exports, kept so a finished clip offers Download instead of re-rendering. */
  const [exported, setExported] = useState<Record<number, { url: string; filename: string }>>({});
  /** Result drafts exist locally until the user explicitly keeps a clip. */
  const [runId, setRunId] = useState("");
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const [archiveStatuses, setArchiveStatuses] = useState<Record<number, string>>({});
  const rawCache = useRef<Record<number, Blob>>({});
  const [saving, setSaving] = useState<number | "all" | null>(null);
  const savingRef = useRef(false);
  const exportLock = useRef(false);
  const submittedEstimate = useRef<number | null>(null);
  const submittedAnalysisCost = useRef<number | null>(null);
  const recoveringSource = useRef<string | null>(null);
  const [editorSettings, setEditorSettings] = useState<Partial<Record<number, EditorExportSettings>>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadWarning, setDownloadWarning] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimatedSparks, setEstimatedSparks] = useState<number | null>(null);
  const [estimatedForUrl, setEstimatedForUrl] = useState<string | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ title: string | null; thumbnail: string | null } | null>(null);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [probeRevision, setProbeRevision] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [contentType, setContentType] = useState<ContentType>(DEFAULT_CONTENT_TYPE);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  // File upload flow ("Upload file" mode)
  const [inputMode, setInputMode] = useState<"url" | "file">("url");
  const [dragActive, setDragActive] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [proGateOpen, setProGateOpen] = useState(false);
  const [clipCount, setClipCount] = useState<ClipCount>(DEFAULT_CLIP_COUNT);
  const [confirmMaxOpen, setConfirmMaxOpen] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  // Background health poll — lets the UI notice the processing service going
  // down (or coming back) without the user having to reload the page.
  const [serverOffline, setServerOffline] = useState(false);
  // Set while runAnalysis is retrying the initial connection after a network
  // failure, before any SSE data has arrived.
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { balance, tier, sync } = useSparks();
  const isPro = tier === "pro";
  const busy = downloading !== null || zipProgress !== null || saving !== null;
  const outOfSparks = balance !== null && balance < MIN_ANALYZE_COST;
  // Full estimate = VOD length cost (probed) + clip count cost.
  const totalEstimate = estimatedSparks !== null ? estimatedSparks + CLIP_COUNT_COST[clipCount] : null;
  const cantAfford =
    !outOfSparks && balance !== null && totalEstimate !== null && totalEstimate > balance;
  const sourceReady = inputMode === "file" ? uploadedFile !== null && uploadPct === null : VOD_URL_PATTERN.test(url) && estimatedForUrl === url;
  const canSubmit = sourceReady && totalEstimate !== null && !estimating && !estimateError && !busy && !loading && !outOfSparks && !cantAfford;

  const editorClips = useMemo<SavedClip[]>(() => (clips ?? []).map((clip, index) => ({
    id: savedIds[index] ?? "", url: analyzedUrl, title: clip.title, clip_type: clip.type,
    viral_score: clip.viral_score, caption: clip.caption, reason: clip.reason,
    start_seconds: clip.start_seconds, end_seconds: clip.end_seconds,
    hooks: clip.hooks, words: clip.words, created_at: new Date(0).toISOString(),
    archive_status: archiveStatuses[index] ?? null,
  })), [clips, savedIds, analyzedUrl, archiveStatuses]);
  useEffect(() => {
    const entries = Object.entries(savedIds);
    if (!entries.length) return;
    let active = true;
    const refresh = async () => {
      const { data } = await createClient().from('clips').select('id,archive_status').in('id', entries.map(([, id]) => id));
      if (!active || !data) return;
      const byId = new Map(data.map(row => [row.id, row.archive_status]));
      setArchiveStatuses(previous => {
        const next = { ...previous };
        let changed = false;
        for (const [index, id] of entries) {
          const status = byId.get(id);
          if (status && next[Number(index)] !== status) { next[Number(index)] = status; changed = true; }
        }
        return changed ? next : previous;
      });
    };
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [savedIds]);
  const draftId = (index: number) => `result-${runId}-${index}`;
  const updateEditorSettings = useCallback((settings: EditorExportSettings) => {
    if (previewIndex === null) return;
    setEditorSettings((previous) => ({ ...previous, [previewIndex]: settings }));
  }, [previewIndex]);

  // Content type persists across sessions — keyword is per-analysis, so it
  // intentionally does NOT persist (a stale keyword lingering onto an
  // unrelated VOD would be a confusing default).
  useEffect(() => {
    const storedContentType = localStorage.getItem("klyp-content-type");
    if ((CONTENT_TYPES as readonly string[]).includes(storedContentType ?? "")) {
      setContentType(storedContentType as ContentType);
    }
  }, []);
  const updateContentType = (value: ContentType) => {
    setContentType(value);
    localStorage.setItem("klyp-content-type", value);
  };

  // Probe video duration as the user types/pastes a URL, debounced.
  useEffect(() => {
    if (inputMode !== "url") return;
    let cancelled = false;
    setEstimatedSparks(null);
    setEstimatedForUrl(null);
    setPreviewDuration(null);
    setPreviewMeta(null);
    setPreviewImageFailed(false);
    setEstimateError(null);
    if (!VOD_URL_PATTERN.test(url)) {
      setEstimating(false);
      return;
    }

    setEstimating(true);
    const probe = setTimeout(async () => {
      try {
        const res = await processingFetch(`/api/duration?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error("Could not check this VOD.");
        const data = await res.json();
        if (!Number.isFinite(data.sparks) || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0) {
          throw new Error("VOD metadata did not include a usable duration or Sparks estimate.");
        }
        if (!cancelled) {
          setEstimatedSparks(data.sparks);
          setEstimatedForUrl(url);
          setPreviewDuration(data.durationSeconds);
          setPreviewMeta({ title: typeof data.title === "string" ? data.title : null, thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : null });
        }
      } catch {
        if (!cancelled) setEstimateError("Couldn’t confirm the VOD length or Sparks cost. Check the link and try again.");
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 600);

    return () => { cancelled = true; clearTimeout(probe); };
  }, [url, inputMode, probeRevision]);

  const switchMode = (mode: "url" | "file") => {
    if (mode === inputMode || loading) return;
    setInputMode(mode);
    setFileError(null);
    if (mode === "file") {
      // Restore the uploaded file's cost estimate (the URL probe effect skips file mode).
      setEstimating(false);
      setEstimatedSparks(uploadedFile?.sparks ?? null);
      setPreviewDuration(uploadedFile?.durationSeconds ?? null);
      setEstimateError(null);
    }
  };

  const clearUpload = () => {
    setUploadedFile(null);
    setEstimatedSparks(null);
    setPreviewDuration(null);
    setFileError(null);
  };

  /** Validate + upload a local VOD file, streaming progress. */
  const handleFile = async (file: File) => {
    setFileError(null);
    if (!UPLOAD_EXT_PATTERN.test(file.name)) {
      setFileError("Unsupported file type — upload an MP4, MOV, or AVI video.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError("File too large — use a URL instead or trim your VOD first.");
      return;
    }

    setUploadedFile(null);
    setUploadPct(0);
    // R2 is opt-in on the processing service. A connection/configuration
    // failure must not silently route a large upload back to Railway disk.
    try {
      const capabilities = await processingFetch('/api/upload/r2');
      if (!capabilities.ok) throw new Error('Upload storage is unavailable. Try again shortly.');
      const { enabled } = await capabilities.json();
      if (enabled) {
        const data = await uploadFileToR2(file, processingFetch, fetch, localStorage, setUploadPct);
        setUploadedFile({ id: data.uploadId, name: file.name, size: file.size,
          durationSeconds: data.durationSeconds, sparks: data.sparks });
        setEstimatedSparks(data.sparks);
        setPreviewDuration(data.durationSeconds);
        setUploadPct(null);
        return;
      }
    } catch (error) {
      setUploadPct(null);
      setFileError(error instanceof Error ? error.message : 'Upload failed.');
      return;
    }
    // XMLHttpRequest instead of fetch — it reports upload progress. Not a
    // fetch call, so it needs the processing-service URL + auth token attached
    // by hand rather than going through processingFetch().
    const token = await processingAuthToken();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", processingUrl("/api/upload"));
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploadPct(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) {
          setFileError(data?.error ?? `Upload failed (HTTP ${xhr.status}).`);
          return;
        }
        setUploadedFile({
          id: data.uploadId,
          name: file.name,
          size: file.size,
          durationSeconds: data.durationSeconds,
          sparks: data.sparks,
        });
        setEstimatedSparks(data.sparks);
        setPreviewDuration(data.durationSeconds);
      } catch {
        setFileError("Upload failed — unexpected server response.");
      }
    };
    xhr.onerror = () => {
      setUploadPct(null);
      setFileError("Upload failed — network error.");
    };
    xhr.send(file);
  };

  // Poll /api/health in the background so a dropped dev/processing server is
  // noticed (and recovered from) automatically instead of requiring a reload.
  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await processingFetch("/api/health", { signal: controller.signal });
        clearTimeout(timeout);
        if (!cancelled) setServerOffline(!res.ok);
      } catch {
        if (!cancelled) setServerOffline(true);
      }
    };
    void checkHealth();
    const interval = setInterval(checkHealth, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Tick the per-stage ETA down once per second while analyzing.
  useEffect(() => {
    if (!loading || etaRemaining === null) return;
    const tick = setInterval(
      () => setEtaRemaining((s) => (s !== null && s > 0 ? s - 1 : s)),
      1000
    );
    return () => clearInterval(tick);
  }, [loading, etaRemaining !== null]);

  // Track real elapsed time in the current stage. The ETA is only an estimate;
  // once it hits zero the elapsed clock is the only honest thing we can show.
  useEffect(() => {
    if (!loading || stageStartedAt === null) return;
    const tick = setInterval(() => setStageElapsed(Math.floor((Date.now() - stageStartedAt) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [loading, stageStartedAt]);

  const saveClipsToSupabase = async (vodUrl: string, clipsToSave: ClipWithWords[]) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to keep your clips.");
    const rows = clipsToSave.map((clip) => ({
      user_id: user.id,
      url: vodUrl,
      title: clip.title,
      clip_type: clip.type,
      viral_score: Math.round(clip.viral_score),
      caption: clip.caption,
      reason: clip.reason,
      start_seconds: clip.start_seconds,
      end_seconds: clip.end_seconds,
      hooks: clip.hooks,
      words: clip.words,
      // Null-safe: a clip from a model response without dimensions still saves.
      dim_hype: clip.dimensions?.hype ?? null,
      dim_emotion: clip.dimensions?.emotion ?? null,
      dim_skill: clip.dimensions?.skill ?? null,
      dim_comedy: clip.dimensions?.comedy ?? null,
      dim_storyline: clip.dimensions?.storyline ?? null,
    }));
    let { data, error } = await supabase.from("clips").insert(rows).select("id,archive_status");
    if (error && ["PGRST204", "42703"].includes(error.code) && /hooks|words|dim_/.test(error.message)) {
      const fallback = await supabase.from("clips").insert(rows.map(({ hooks, words, dim_hype, dim_emotion, dim_skill, dim_comedy, dim_storyline, ...rest }) => rest)).select("id,archive_status");
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw new Error(error.message || "Could not save clips. Please try again.");
    if (!data || data.length !== rows.length) throw new Error("Could not confirm clips were added. Refresh your library before retrying.");
    return data.map((row) => ({ id: row.id as string, archiveStatus: row.archive_status as string }));
  };

  const handleEvent = (event: AnalyzeEvent) => {
    if (event.type === "job") {
      const saved = localStorage.getItem("klyp-active-analysis-job");
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          localStorage.setItem("klyp-active-analysis-job", JSON.stringify({ ...draft, id: event.jobId, body: { ...draft.body, jobId: event.jobId } }));
        } catch { /* invalid draft */ }
      }
      return;
    }
    if (event.type === "progress") {
      // Real forward motion — the only thing that should reset the stall watchdog.
      rearmProgressWatchdog.current?.();
      setStages((prev) => ({ ...prev, [event.stage]: event.status }));
      if (event.status === "running") {
        setEtaRemaining(event.etaSeconds ?? null);
        setStageStartedAt(Date.now());
        setStageElapsed(0);
      }
      return;
    }
    if (event.type === "result") {
      localStorage.removeItem("klyp-active-analysis-job");
      setStages((prev) => ({ ...prev, done: "done" }));
      setEtaRemaining(null);
      setStageStartedAt(null);
      setClips(event.clips);
      // Default each clip to the user's preferred style (Settings → Clip Defaults).
      const stored = localStorage.getItem("klyp-default-style");
      const defaultStyle: CaptionStyle =
        stored && (CAPTION_STYLES as readonly string[]).includes(stored)
          ? (stored as CaptionStyle)
          : "BOLD";
      setClipStyles(Object.fromEntries(event.clips.map((_, i) => [i, defaultStyle])));
      // Default: first hook selected, 9:16 vertical.
      setExported((prev) => {
        for (const e of Object.values(prev)) URL.revokeObjectURL(e.url);
        return {};
      });
      setRunId(crypto.randomUUID());
      rawCache.current = {};
      setSavedIds({});
      setArchiveStatuses({});
      setEditorSettings({});
      setClipHooks(Object.fromEntries(event.clips.map((c, i) => [i, c.hooks?.[0] ?? null])));
      setClipFormats(Object.fromEntries(event.clips.map((_, i) => [i, "9:16" as ExportFormat])));
      // All clips start unsaved — the user decides what enters their library.
      setClipStatus(Object.fromEntries(event.clips.map((_, i) => [i, "unsaved" as const])));
      const charge = resultsChargeMessage(
        event.sparksSpent, submittedEstimate.current, submittedAnalysisCost.current, event.clips.length
      );
      setAnalysisNote(event.clips.length === 0
        ? `No new moments cleared the quality floor. ${charge} Try another VOD or adjust your topic.`
        : charge);
      setAnalyzedUrl(recoveringSource.current ?? sourceRef);
      recoveringSource.current = null;
      // The server already deducted — mirror its authoritative balance.
      sync(event.sparksBalance);
      return;
    }
    // error event
    setError(`${event.error} (failed at: ${event.stage})`);
  };

  // What /api/clip, /api/preview and saved rows reference as the clip source:
  // the VOD URL, or "upload:<id>" for uploaded files.
  const sourceRef = inputMode === "file" && uploadedFile ? `upload:${uploadedFile.id}` : url;

  const recoverJob = async (id: string, source: string, body: Record<string, unknown> | undefined, cancelled: () => boolean) => {
    recoveringSource.current = source;
    let lastResumeAttempt = 0;
    for (let attempt = 0; attempt < 620 && !cancelled(); attempt++) {
      try {
        const response = await processingFetch(`/api/analyze/jobs/${id}`);
        if (response.ok) {
          const status = await response.json();
          if (status.status === "completed" && status.result) { handleEvent(status.result as AnalyzeEvent); return; }
          if (status.status === "failed") {
            handleEvent({ type: "error", stage: status.stage ?? "analyze", error: status.error ?? "Analysis failed." });
            return;
          }
          const stale = status.status === "running" && status.updatedAt && Date.now() - Date.parse(status.updatedAt) > 4 * 60_000;
          if (body && (status.status === "queued" || stale) && Date.now() - lastResumeAttempt > 30_000) {
            lastResumeAttempt = Date.now();
            void processingFetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
              .then((res) => res.body?.cancel()).catch(() => {});
          }
          setStages((prev) => ({ ...prev, [status.stage as AnalyzeStage]: "running" }));
        } else if (response.status === 404) {
          localStorage.removeItem("klyp-active-analysis-job");
          setError("Could not find the previous analysis job. You can start again.");
          return;
        } else if (response.status === 401 || response.status === 403) {
          setError("Sign in to check your saved analysis job.");
          return;
        }
      } catch { /* transient connection loss; keep polling the durable job */ }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  };

  useEffect(() => {
    const raw = localStorage.getItem("klyp-active-analysis-job");
    if (!raw) return;
    let saved: { id: string; source: string; body?: Record<string, unknown> };
    try { saved = JSON.parse(raw); } catch { localStorage.removeItem("klyp-active-analysis-job"); return; }
    if (!saved.id || !saved.source) return;
    let cancelled = false;
    setLoading(true);
    void recoverJob(saved.id, saved.source, saved.body, () => cancelled).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Recovery intentionally reads the saved job once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyze = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // MAX mode is the priciest run — require explicit confirmation before
    // anything fires. Nothing is charged at this point either way: the server
    // deducts Sparks only after the analysis completes (see /api/analyze).
    if (clipCount === MAX_CLIP_COUNT) {
      setConfirmMaxOpen(true);
      return;
    }
    void runAnalysis();
  };

  const runAnalysis = async () => {
    if (exportLock.current || savingRef.current) return;
    submittedEstimate.current = totalEstimate;
    submittedAnalysisCost.current = estimatedSparks;
    setLoading(true);
    setError(null);
    setClips(null);
    setAnalysisNote(null);
    setStages({ ...INITIAL_STAGES });
    setEtaRemaining(null);
    setStageStartedAt(null);
    setStageElapsed(0);
    setReconnectAttempt(null);
    const requestBody = inputMode === "file" && uploadedFile
      ? { uploadId: uploadedFile.id, durationHint: uploadedFile.durationSeconds, clipCount, contentType, keyword: keyword.trim() || undefined }
      : { url, durationHint: previewDuration ?? undefined, clipCount, contentType, keyword: keyword.trim() || undefined };
    let jobId = crypto.randomUUID();
    try {
      const saved = JSON.parse(localStorage.getItem("klyp-active-analysis-job") ?? "null");
      if (saved?.source === sourceRef && JSON.stringify({ ...saved.body, jobId: undefined }) === JSON.stringify({ ...requestBody, jobId: undefined })) jobId = saved.id;
    } catch { /* invalid previous draft */ }
    const body = { ...requestBody, jobId };
    localStorage.setItem("klyp-active-analysis-job", JSON.stringify({ id: jobId, source: sourceRef, body }));

    try {
      const requestInit: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };

      // A network-level failure here (fetch() throwing, not an HTTP error
      // response) means the connection to the server never happened at all —
      // most often a dev server that's mid-restart. Retry with backoff before
      // surfacing "Connection lost" so a brief hiccup doesn't need a manual retry.
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await processingFetch("/api/analyze", requestInit);
          setReconnectAttempt(null);
          break;
        } catch (err) {
          if (attempt >= ANALYZE_RETRY_DELAYS_MS.length) throw err;
          setReconnectAttempt(attempt + 1);
          await new Promise((r) => setTimeout(r, ANALYZE_RETRY_DELAYS_MS[attempt]));
        }
      }

      // Validation failures come back as plain JSON before the stream starts.
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await res.json().catch(() => null);
        if (data?.type === "result") { handleEvent(data as AnalyzeEvent); return; }
        localStorage.removeItem("klyp-active-analysis-job");
        setError(data?.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }

      // Read the SSE stream: events arrive as "data: {...}\n\n" frames.
      // The server heartbeats every 10s — if nothing arrives for 45s the
      // connection is dead, so cancel the read instead of spinning forever.
      const WATCHDOG_MS = 45_000;
      // Separate, much longer watchdog for *progress*. The heartbeat above
      // proves only that the socket is alive — it fires on a timer that knows
      // nothing about the pipeline, so a wedged job keeps the connection
      // looking perfectly healthy forever. This one is reset ONLY by real
      // progress events, so a stage that stops advancing is caught even while
      // pings keep arriving. Generous, because transcribing a multi-hour VOD
      // legitimately runs long without emitting anything.
      const NO_PROGRESS_MS = 30 * 60_000;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalEvent = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let progressWatchdog: ReturnType<typeof setTimeout> | undefined;
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          reader.cancel().catch(() => {});
        }, WATCHDOG_MS);
      };
      const armProgressWatchdog = () => {
        clearTimeout(progressWatchdog);
        progressWatchdog = setTimeout(() => {
          reader.cancel().catch(() => {});
        }, NO_PROGRESS_MS);
      };
      rearmProgressWatchdog.current = armProgressWatchdog;
      armWatchdog();
      armProgressWatchdog();

      try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armWatchdog();
        buffer += decoder.decode(value, { stream: true });

        let frameEnd;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            const event = JSON.parse(dataLine.slice(6)) as AnalyzeEvent;
            if (event.type === "result" || event.type === "error") terminalEvent = true;
            handleEvent(event);
          }
        }
      }
      } finally {
        clearTimeout(watchdog);
        clearTimeout(progressWatchdog);
        rearmProgressWatchdog.current = null;
      }
      if (!terminalEvent) await recoverJob(jobId, sourceRef, body, () => false);
    } catch {
      setAnalysisNote("Connection interrupted. Checking your saved analysis job…");
      await recoverJob(jobId, sourceRef, body, () => false);
    } finally {
      setReconnectAttempt(null);
      // Brief pause so the final "Done!" check is visible before closing.
      setTimeout(() => setLoading(false), 1200);
    }
  };

  /** Render one clip via /api/clip and return the MP4 blob. */
  const fetchClipBlob = async (clip: ClipWithWords, style: CaptionStyle, index: number, raw = false): Promise<{ blob: Blob; warning: string | null }> => {
    // Timeout so a hung export fails loudly instead of spinning forever. The
    // server keeps working after an abort, so a retry usually hits a warm cache.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    try {
    const res = await processingFetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(
        raw
          ? {
              // Clean source moment: original framing/audio, no Klyp editing layers.
              url: analyzedUrl,
              clip_id: savedIds[index] || undefined,
              start_seconds: clip.start_seconds,
              end_seconds: clip.end_seconds,
              title: clip.title,
              raw: true,
            }
          : {
              url: analyzedUrl,
              start_seconds: clip.start_seconds,
              end_seconds: clip.end_seconds,
              title: clip.title,
              style,
              words: clip.words,
              handle: getStoredHandle(),
              hook: clipHooks[index] ?? undefined,
              // Keep the burn identical to the preview overlay (black pill bar).
              hook_style: "IMPACT",
              aspect_ratio: resolveExportFormat(clipFormats[index] ?? "9:16", isPro),
              ...editorSettings[index],
              clip_id: savedIds[index],
            }
      ),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `Clip generation failed (HTTP ${res.status}).`);
    }
    return { blob: await res.blob(), warning: res.headers.get("X-Klyp-Layout-Warning") };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          "Export timed out after 10 minutes — the source VOD may still be downloading in the background. Try again in a bit."
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  };

  const clipFilename = (clip: ClipWithWords, index: number, raw = false) => {
    const safe = clip.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
    return (safe || `klyp_clip_${index + 1}`) + (raw ? "_raw" : "") + ".mp4";
  };

  const keepIndices = async (indices: number[]): Promise<string[] | undefined> => {
    if (!clips || savingRef.current || exportLock.current || indices.length === 0) return;
    savingRef.current = true;
    setSaving(indices.length === 1 ? indices[0] : "all");
    setDownloadError(null);
    try {
      const ids = await saveClipsToSupabase(analyzedUrl, indices.map((index) => clips[index]));
      setSavedIds((previous) => ({ ...previous, ...Object.fromEntries(indices.map((index, n) => [index, ids[n].id])) }));
      setArchiveStatuses((previous) => ({ ...previous, ...Object.fromEntries(indices.map((index, n) => [index, ids[n].archiveStatus])) }));
      setClipStatus((previous) => ({ ...previous, ...Object.fromEntries(indices.map((index) => [index, "kept" as const])) }));
      indices.forEach((index, n) => {
        try {
          const draft = localStorage.getItem(`klyp-editor-${draftId(index)}`);
          if (draft) localStorage.setItem(`klyp-editor-${ids[n].id}`, draft);
        } catch { /* Local draft storage is optional. */ }
      });
      return ids.map(row => row.id);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not save clips. Try again.");
    } finally { savingRef.current = false; setSaving(null); }
  };
  const keepClip = (index: number) => {
    if (clipStatus[index] === "unsaved") void keepIndices([index]);
  };
  const editClip = async (index: number) => {
    const id = savedIds[index] ?? (await keepIndices([index]))?.[0];
    if (id) window.location.href = `/dashboard/clips/${id}/edit`;
  };
  const discardClip = (index: number) => setClipStatus((previous) => ({ ...previous, [index]: "discarded" }));
  const keepAll = () => { if (clips) void keepIndices(clips.flatMap((_, index) => clipStatus[index] === "unsaved" ? [index] : [])); };

  const downloadClip = async (clip: ClipWithWords, index: number, styleOverride?: CaptionStyle, raw = false) => {
    if (busy || exportLock.current) return;
    if (raw && rawCache.current[index]) {
      saveBlob(rawCache.current[index], clipFilename(clip, index, true));
      return;
    }
    exportLock.current = true;
    setDownloading(index);
    setDownloadElapsed(0);
    const rawStarted = Date.now();
    const rawTicker = raw ? window.setInterval(() => setDownloadElapsed(Math.floor((Date.now() - rawStarted) / 1000)), 1000) : null;
    setDownloadError(null);
    setDownloadWarning(null);

    const style = styleOverride ?? clipStyles[index] ?? "BOLD";
    try {
      const { blob, warning } = await fetchClipBlob(clip, style, index, raw);
      if (raw) rawCache.current[index] = blob;
      if (warning) setDownloadWarning(warning);
      saveBlob(blob, clipFilename(clip, index, raw));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      if (rawTicker !== null) window.clearInterval(rawTicker);
      exportLock.current = false;
      setDownloading(null);
    }
  };

  /** Render every clip sequentially (they share the cached source video) and zip them. */
  const downloadAllAsZip = async () => {
    if (!clips || busy || exportLock.current) return;
    setDownloadError(null);
    setDownloadWarning(null);
    const total = clips.filter((_, i) => clipStatus[i] !== "discarded").length;
    if (total === 0) return;
    exportLock.current = true;
    setZipProgress({ done: 0, total });

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const usedNames = new Set<string>();

      let done = 0;
      for (let i = 0; i < clips.length; i++) {
        if (clipStatus[i] === "discarded") continue;
        const { blob, warning } = await fetchClipBlob(clips[i], clipStyles[i] ?? "BOLD", i);
        if (warning) setDownloadWarning(warning);
        let name = clipFilename(clips[i], i);
        if (usedNames.has(name)) name = `${i + 1}_${name}`;
        usedNames.add(name);
        zip.file(name, blob);
        setZipProgress({ done: ++done, total });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveBlob(zipBlob, "klyp_clips.zip");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "ZIP download failed.");
    } finally {
      exportLock.current = false;
      setZipProgress(null);
    }
  };

  return (
    <section>
      {/* ── Full-screen pipeline progress overlay ── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-surface border border-border rounded-2xl p-8 shadow-2xl">
            <h3 className="font-syne text-xl font-bold text-foreground mb-1">
              Analyzing your VOD
            </h3>
            <p className="text-sm text-foreground-muted mb-7">
              Klyp is hunting for your best moments.
            </p>

            {reconnectAttempt !== null && (
              <p className="-mt-5 mb-7 text-xs text-amber-400">
                Server didn&apos;t respond — reconnecting (attempt {reconnectAttempt}/{ANALYZE_RETRY_DELAYS_MS.length})…
              </p>
            )}

            <ol className="space-y-5">
              {PIPELINE_STEPS.map((step) => {
                const status = stages[step.key];
                return (
                  <li key={step.key} className="flex items-center gap-4">
                    {/* Status icon */}
                    <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                      {status === "done" ? (
                        <span className="w-7 h-7 rounded-full bg-accent-glow border border-accent/40 flex items-center justify-center">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      ) : status === "running" ? (
                        <span className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                      ) : (
                        <span className="w-7 h-7 rounded-full border-2 border-border" />
                      )}
                    </span>

                    {/* Label + ETA */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium transition-colors ${
                          status === "done"
                            ? "text-foreground-muted line-through decoration-accent/40"
                            : status === "running"
                            ? "text-foreground"
                            : "text-subtle"
                        }`}
                      >
                        {step.label}
                      </p>
                      {status === "running" && step.key !== "done" && (
                        <p className="text-xs text-accent mt-0.5">
                          {/* Once the estimate runs out, show real elapsed time.
                              The old "almost done…" was a static string that sat
                              there indefinitely — it read as progress while the
                              backend was wedged, which is worse than no text. */}
                          {etaRemaining !== null && etaRemaining > 0
                            ? `≈ ${etaRemaining >= 60 ? `${Math.ceil(etaRemaining / 60)} min` : `${etaRemaining}s`} remaining`
                            : stageElapsed >= 60
                            ? `still working — ${Math.floor(stageElapsed / 60)}m ${stageElapsed % 60}s elapsed`
                            : stageElapsed > 0
                            ? `still working — ${stageElapsed}s elapsed`
                            : "working…"}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="mt-7 pt-5 border-t border-border text-xs text-foreground-muted text-center">
              Long VODs take a few minutes — feel free to grab a coffee ☕
            </p>
          </div>
        </div>
      )}

      {/* VOD input — URL paste or file upload */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-0.5 font-geist text-lg font-semibold tracking-tight text-white">Analyze a VOD</h2>
        <p className="mb-3 text-[13px] text-foreground-muted">
          Paste a video link or upload a file. Klyp finds the moments worth sharing.
        </p>
        {/* Input mode toggle */}
        <div className="mb-2 flex w-fit gap-1 rounded-lg border border-border bg-background/50 p-0.5">
          {([["url", "Paste URL"], ["file", "Upload file"]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              disabled={loading}
              className={`min-h-8 rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                inputMode === mode
                  ? "bg-accent/15 text-accent"
                  : "text-foreground-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={analyze} className="min-w-0">
          {inputMode === "url" ? (
            <div>
              <input
                type="url"
                required
                aria-label="VOD URL"
                value={url}
                onChange={(e) => setUrl(e.target.value.trim())}
                placeholder="Paste a YouTube or Twitch VOD link"
                disabled={loading || outOfSparks}
                className="min-h-10 w-full min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-foreground placeholder:text-foreground-muted transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
              />
              {estimating && <div role="status" className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-foreground-muted">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" /> Checking VOD details and Sparks cost…
              </div>}
              {previewDuration !== null && !estimating && <div className="mt-2 flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-2/75 p-2">
                <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-xs text-foreground-muted sm:w-28">
                  {previewMeta?.thumbnail && !previewImageFailed
                    ? <img src={previewMeta.thumbnail} alt="" onError={() => setPreviewImageFailed(true)} className="h-full w-full object-cover" />
                    : <span>VOD preview</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{previewMeta?.title || `${platformName(url)} VOD ready`}</p>
                  <p className="mt-0.5 text-xs text-foreground-muted">{platformName(url)} · {fmtTime(previewDuration)} · ready to analyze</p>
                </div>
              </div>}
              {estimateError && <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                <span>{estimateError}</span>
                <button type="button" onClick={() => setProbeRevision((value) => value + 1)} className="font-semibold underline underline-offset-2">Retry</button>
              </div>}
              {url && !VOD_URL_PATTERN.test(url) && <p className="mt-2 text-xs text-foreground-muted">Use a Twitch or YouTube VOD link to get started.</p>}
            </div>
          ) : (
            <>
              {uploadedFile ? (
                /* Uploaded file summary */
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-accent/40 bg-accent-glow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-foreground-muted">
                      {fmtBytes(uploadedFile.size)} · {fmtTime(uploadedFile.durationSeconds)} · ready to analyze
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearUpload}
                    disabled={loading}
                    title="Remove file"
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                /* Drop zone */
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFile(f);
                  }}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-7 transition-colors ${
                    dragActive
                      ? "border-accent bg-accent-glow"
                      : "border-border bg-surface-2/60 hover:border-accent/40 hover:bg-surface-2"
                  }`}
                >
                  {uploadPct !== null ? (
                    <>
                      <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                      <p className="text-sm text-foreground mt-1">Uploading… {uploadPct}%</p>
                      <div className="w-full max-w-xs h-1.5 rounded-full bg-surface-2 border border-border overflow-hidden mt-1">
                        <div className="h-full bg-accent transition-all" style={{ width: `${uploadPct}%` }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={dragActive ? "#00E5A0" : "#5a5a72"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <p className="text-sm font-medium text-foreground mt-1">Drop your VOD file here</p>
                      <p className="text-xs text-foreground-muted">MP4, MOV, AVI up to 4GB</p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading || outOfSparks}
                        className="mt-2 px-4 py-2 rounded-lg border border-accent/40 text-accent text-xs font-bold font-syne hover:bg-accent-glow transition-colors disabled:opacity-50"
                      >
                        Browse files
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,video/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFile(f);
                          e.target.value = "";
                        }}
                      />
                    </>
                  )}
                </div>
              )}

              {fileError && (
                <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                  {fileError}
                </div>
              )}

            </>
          )}

        <details className="group mt-3 rounded-lg border border-border bg-background/35">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm text-foreground-muted marker:content-none hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <span className="min-w-0"><span className="font-semibold text-foreground">Clip Settings</span><span className="ml-2 font-normal text-foreground-muted">{clipCount} clips · {CONTENT_TYPE_LABELS[contentType]}{keyword.trim() ? " · topic added" : ""}</span></span>
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 7.5 5 5 5-5" /></svg>
          </summary>
          <div className="grid gap-3 border-t border-border px-3 py-3 lg:grid-cols-2">
        {/* Clip count selector */}
        <div className="min-w-0">
          <span
            className="mb-1.5 block text-xs font-medium text-foreground cursor-help"
            title="We only return clips worth posting — if your VOD doesn't have 10 great moments you'll get fewer"
          >
            Number of clips <span className="text-foreground-muted">ⓘ</span>
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CLIP_COUNT_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setClipCount(n)}
                disabled={loading}
                aria-pressed={clipCount === n}
                className={`min-h-11 rounded-lg border px-2 py-1 text-center text-xs font-semibold transition-colors disabled:opacity-50 ${
                  clipCount === n
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface-2 text-foreground-muted hover:border-subtle hover:text-foreground"
                }`}
              >
                <span className="block">{n === MAX_CLIP_COUNT ? `${n} MAX clips` : `${n} clips`}</span>
                <span className="mt-0.5 block font-normal opacity-85">{CLIP_COUNT_COST[n]} Sparks <span aria-hidden="true" className="ml-0.5 text-[11px] text-amber-400">⚡</span></span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">

        {/* Content type — changes which clip types MIDAS looks for */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="text-xs font-medium text-foreground whitespace-nowrap cursor-help"
            title="Gaming picks from CLUTCH/EPIC/BIG_BRAIN etc; IRL swaps those for STORY_TIME/AWKWARD/PUBLIC_INTERACTION"
          >
            Content type <span className="text-foreground-muted">ⓘ</span>
          </span>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {CONTENT_TYPES.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => updateContentType(ct)}
                disabled={loading}
                aria-pressed={contentType === ct}
                className={`min-h-8 rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  contentType === ct
                    ? "bg-accent/15 text-accent"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {CONTENT_TYPE_LABELS[ct]}
              </button>
            ))}
          </div>
        </div>

        {/* Keyword or topic — weights matching transcript moments higher when picking clips */}
        <div className="mt-2 min-w-0">
          <label htmlFor="klyp-keyword" className="mb-1 block text-xs font-medium text-foreground">
            Keyword or topic (optional)
          </label>
          <div className="flex min-h-8 w-full items-center rounded-lg border border-border bg-surface-2 px-3 focus-within:border-accent transition-colors">
            <input
              id="klyp-keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value.slice(0, 100))}
              placeholder="e.g. clutch, funny moment, Kai"
              disabled={loading}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-muted focus:outline-none disabled:opacity-50"
            />
          </div>
          <span className="mt-0.5 block text-[11px] text-foreground-muted">
            {keyword.trim()
              ? `moments mentioning "${keyword.trim()}" are weighted higher`
              : "Leave blank to find the best moments."}
          </span>
        </div>
        </div>
          </div>
        </details>

        {/* Show the breakdown only after the VOD duration has been verified. */}
        {totalEstimate !== null && !estimating && (
          <div className="mt-3 rounded-lg border border-border bg-surface-2/70 p-3" aria-live="polite">
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs text-foreground-muted">Maximum estimate</p>
                <p className={`mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums ${cantAfford ? "text-red-400" : "text-accent"}`}>
                  <SparkIcon size={17} />{totalEstimate} Sparks
                </p>
              </div>
              <div className="border-l border-border pl-3 sm:pl-4">
                <p className="text-xs text-foreground-muted">Analyze VOD {previewDuration ? `(${fmtTime(previewDuration)})` : ""}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{estimatedSparks} Sparks</p>
              </div>
              <div className="border-l border-border pl-3 sm:pl-4">
                <p className="text-xs text-foreground-muted">Up to {clipCount} clips</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{CLIP_COUNT_COST[clipCount]} Sparks</p>
              </div>
            </div>
            <p className="mt-2 border-t border-border pt-1.5 text-[11px] leading-relaxed text-foreground-muted">VOD analysis is {estimatedSparks} Sparks. Clip charges depend on how many qualify.</p>
            {cantAfford && <p role="alert" className="mt-2 text-xs text-red-400">Not enough Sparks: this costs {totalEstimate}, and you have {balance}. <a href="/dashboard/upgrade" className="font-semibold underline">Upgrade to Pro</a></p>}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={!canSubmit}
            className="flex min-h-10 w-full items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-background transition-colors hover:bg-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:w-48">
            {loading ? "Analyzing…" : "Find Clips"}
          </button>
        </div>

        {/* Processing server unreachable — set by the background health poll, clears itself */}
        {serverOffline && !loading && (
          <div className="flex items-center gap-2 mt-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
            Processing server unreachable — retrying automatically. This clears on its own once it's back.
          </div>
        )}

        {/* Out of Sparks */}
        {outOfSparks && (
          <div className="flex items-center gap-2 mt-4 px-4 py-3 rounded-lg bg-accent-glow border border-accent/30 text-sm">
            <SparkIcon size={14} className="text-accent flex-shrink-0" />
            <span className="text-foreground">
              You&apos;re out of Sparks —{" "}
              <a href="/dashboard/upgrade" className="text-accent font-semibold hover:underline">
                upgrade to Pro
              </a>{" "}
              to get more ⚡
            </span>
          </div>
        )}

        {error && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400" role="alert">
            <p>{error}</p>
            {isYouTubeBotBlockError(error) && (
              <button type="button" onClick={() => { switchMode("file"); setError(null); }}
                className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-background hover:bg-accent-dim">
                Upload a video file instead
              </button>
            )}
          </div>
        )}
        </form>
      </section>

      {/* Results */}
      {clips && (
        <div className={`mt-6 ${resultsStyles.results}`}>
          {clips.length > 0 && (
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h3 className="font-geist text-2xl font-bold text-white">
                  <span aria-hidden="true" className="mr-2 text-accent">✦</span>We found {clips.length} great {clips.length === 1 ? "moment" : "moments"}!
                </h3>
                <p className="text-[15px] text-foreground-muted mt-0.5">
                  Your stream highlights are ready to review.
                </p>
              </div>
              <div className="flex items-center gap-2">
              <button
                onClick={keepAll}
                disabled={busy || !clips.some((_, i) => clipStatus[i] === "unsaved")}
                title="Save every remaining clip to Found Moments"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-border text-foreground text-[13px] font-semibold hover:border-accent/50 transition-colors disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Keep all
              </button>
              <button
                onClick={downloadAllAsZip}
                disabled={busy || !clips.some((_, i) => clipStatus[i] !== "discarded")}
                title="Renders every remaining clip, then downloads them as one .zip"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-accent/40 text-accent text-[13px] font-bold hover:bg-accent-glow transition-colors disabled:opacity-50"
              >
                {zipProgress ? (
                  <>
                    <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                    Rendering {zipProgress.done}/{zipProgress.total}…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download all (.zip)
                  </>
                )}
              </button>
              </div>
            </div>
          )}

          {analysisNote && (
            <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-accent-glow border border-accent/30 text-sm text-foreground">
              <SparkIcon size={14} className="text-accent flex-shrink-0" />
              {analysisNote}
            </div>
          )}

          {downloadError && (
            <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {downloadError}
            </div>
          )}
          {downloadWarning && <div role="status" className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 text-sm text-amber-300">{downloadWarning}</div>}
          {clips.length > 0 && clips.every((_, i) => clipStatus[i] === "discarded") && (
            <p className="text-sm text-foreground-muted text-center py-8">
              All clips discarded. Analyze another VOD to find more moments.
            </p>
          )}
          <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
            {clips.map((clip, i) => clipStatus[i] === "discarded" ? null : <FoundClipCard
              key={i} clip={editorClips[i]} kept={clipStatus[i] === "kept"} busy={busy}
              saving={saving === i || saving === "all"} exporting={downloading === i}
              rawSeconds={downloading === i ? downloadElapsed : 0}
              onPreview={() => { if (!busy) setPreviewIndex(i); }} onCustomize={() => void editClip(i)}
              onRawExport={() => void downloadClip(clip, i, undefined, true)}
              onKeep={() => keepClip(i)} onDiscard={() => discardClip(i)} />)}
          </div>
        </div>
      )}

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}

      {/* MAX clips confirmation — nothing runs (and nothing is charged) until confirmed. */}
      {confirmMaxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmMaxOpen(false); }}
        >
          <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-5 space-y-3">
            <p className="font-syne font-bold text-foreground">MAX clips analysis</p>
            <p className="text-sm text-foreground-muted">
              Are you sure? You are using{" "}
              <span className="font-syne font-bold text-accent">
                {totalEstimate ?? CLIP_COUNT_COST[clipCount]}⚡
              </span>{" "}
              for <span className="font-syne font-bold text-accent">{clipCount} clips</span>
              {totalEstimate === null && <> (plus the VOD-length cost, added once the video is probed)</>}.
            </p>
            <p className="text-[11px] text-subtle">
              Fewer clips may come back (quality floor) — you&apos;re only charged for what MIDAS
              actually returns, and nothing is deducted until the analysis completes.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmMaxOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold font-syne text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmMaxOpen(false); void runAnalysis(); }}
                className="px-3 py-1.5 rounded-lg bg-accent text-background text-xs font-bold font-syne hover:bg-accent-dim transition-colors"
              >
                Yes, analyze
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ── */}
      {previewIndex !== null && clips && (
        <ClipPreviewModal
          clip={editorClips[previewIndex]}
          draftId={savedIds[previewIndex] ?? draftId(previewIndex)} initialCaptionStyle={clipStyles[previewIndex] ?? "BOLD"}
          onSettingsChange={updateEditorSettings} initialSettings={editorSettings[previewIndex]}
          onExportStateChange={(working, error) => {
            exportLock.current = working;
            setDownloading(working ? previewIndex : null);
            if (working) setDownloadError(null);
            else if (error) setDownloadError(error);
          }}
          onKeepClip={() => keepClip(previewIndex)} savingClip={saving !== null} saveError={downloadError}
          onClose={() => setPreviewIndex(null)}
          onEditClip={() => void editClip(previewIndex)}
          onDownloadRaw={() => void downloadClip(clips[previewIndex], previewIndex, undefined, true)}
          rawWorking={downloading === previewIndex}
          rawSeconds={downloadElapsed}
          exportState={undefined} onCreateClip={() => void downloadClip(clips[previewIndex], previewIndex)}
          onDownloadClip={() => void downloadClip(clips[previewIndex], previewIndex)}
        />
      )}
    </section>
  );
}
