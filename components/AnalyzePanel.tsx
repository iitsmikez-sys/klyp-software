"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import type { ClipType, AnalyzeEvent, AnalyzeStage, ClipWithWords, CaptionStyle, ExportFormat } from "@/lib/clips";
import { CAPTION_STYLES, EXPORT_FORMATS, FORMAT_LABELS } from "@/lib/clips";
import { MIN_ANALYZE_COST } from "@/lib/sparks";
import { useSparks } from "./SparksProvider";
import { SparkIcon } from "./SparksBalance";
import ClipPreview from "./ClipPreview";
import ProGateModal from "./ProGateModal";
import { createClient } from "@/lib/supabase/client";

const VOD_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|twitch\.tv\/videos\/|m\.twitch\.tv\/videos\/)/i;

const TYPE_STYLES: Record<ClipType, string> = {
  CLUTCH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FUNNY: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  RAGE: "bg-red-500/15 text-red-400 border-red-500/30",
  EPIC: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  FAIL: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  BIG_BRAIN: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  EMOTIONAL: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  SUS: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
};

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
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipWithWords[] | null>(null);
  const [clipStyles, setClipStyles] = useState<Record<number, CaptionStyle>>({});
  const [clipHooks, setClipHooks] = useState<Record<number, string | null>>({});
  const [clipFormats, setClipFormats] = useState<Record<number, ExportFormat>>({});
  // Library decision per clip — nothing is saved to Supabase until the user keeps it.
  const [clipStatus, setClipStatus] = useState<Record<number, "unsaved" | "kept" | "discarded">>({});
  const [downloading, setDownloading] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimatedSparks, setEstimatedSparks] = useState<number | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const [handle, setHandle] = useState("");
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  // File upload flow ("Upload file" mode)
  const [inputMode, setInputMode] = useState<"url" | "file">("url");
  const [dragActive, setDragActive] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [proGateOpen, setProGateOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { balance, tier, sync } = useSparks();
  const isPro = tier === "pro";
  const busy = downloading !== null || zipProgress !== null;
  const outOfSparks = balance !== null && balance < MIN_ANALYZE_COST;
  const cantAfford =
    !outOfSparks && balance !== null && estimatedSparks !== null && estimatedSparks > balance;

  // Streamer handle persists across sessions.
  useEffect(() => {
    setHandle(localStorage.getItem("klyp-handle") ?? "");
  }, []);
  const updateHandle = (value: string) => {
    const clean = value.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 25);
    setHandle(clean);
    localStorage.setItem("klyp-handle", clean);
  };

  // Probe video duration as the user types/pastes a URL, debounced.
  useEffect(() => {
    if (inputMode !== "url") return;
    setEstimatedSparks(null);
    setPreviewDuration(null);
    if (!VOD_URL_PATTERN.test(url)) {
      setEstimating(false);
      return;
    }

    setEstimating(true);
    const probe = setTimeout(async () => {
      try {
        const res = await fetch(`/api/duration?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          setEstimatedSparks(data.sparks);
          setPreviewDuration(data.durationSeconds);
        }
      } catch {
        // Estimation is best-effort; analysis still works without it.
      } finally {
        setEstimating(false);
      }
    }, 600);

    return () => clearTimeout(probe);
  }, [url, inputMode]);

  const switchMode = (mode: "url" | "file") => {
    if (mode === inputMode || loading) return;
    setInputMode(mode);
    setFileError(null);
    if (mode === "file") {
      // Restore the uploaded file's cost estimate (the URL probe effect skips file mode).
      setEstimating(false);
      setEstimatedSparks(uploadedFile?.sparks ?? null);
      setPreviewDuration(uploadedFile?.durationSeconds ?? null);
    }
  };

  const clearUpload = () => {
    setUploadedFile(null);
    setEstimatedSparks(null);
    setPreviewDuration(null);
    setFileError(null);
  };

  /** Validate + upload a local VOD file, streaming progress. */
  const handleFile = (file: File) => {
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
    // XMLHttpRequest instead of fetch — it reports upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
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

  // Tick the per-stage ETA down once per second while analyzing.
  useEffect(() => {
    if (!loading || etaRemaining === null) return;
    const tick = setInterval(
      () => setEtaRemaining((s) => (s !== null && s > 0 ? s - 1 : s)),
      1000
    );
    return () => clearInterval(tick);
  }, [loading, etaRemaining !== null]);

  const saveClipsToSupabase = async (vodUrl: string, clipsToSave: ClipWithWords[]) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
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
    }));
    const { error } = await supabase.from("clips").insert(rows);
    if (error) {
      // hooks/words columns may not exist yet (migration 003) — save without them.
      await supabase.from("clips").insert(rows.map(({ hooks, words, ...rest }) => rest));
    }
  };

  const handleEvent = (event: AnalyzeEvent) => {
    if (event.type === "progress") {
      setStages((prev) => ({ ...prev, [event.stage]: event.status }));
      if (event.status === "running") {
        setEtaRemaining(event.etaSeconds ?? null);
      }
      return;
    }
    if (event.type === "result") {
      setStages((prev) => ({ ...prev, done: "done" }));
      setEtaRemaining(null);
      setClips(event.clips);
      // Default each clip to the user's preferred style (Settings → Clip Defaults).
      const stored = localStorage.getItem("klyp-default-style");
      const defaultStyle: CaptionStyle =
        stored && (CAPTION_STYLES as readonly string[]).includes(stored)
          ? (stored as CaptionStyle)
          : "BOLD";
      setClipStyles(Object.fromEntries(event.clips.map((_, i) => [i, defaultStyle])));
      // Default: first hook selected, 9:16 vertical.
      setClipHooks(Object.fromEntries(event.clips.map((c, i) => [i, c.hooks?.[0] ?? null])));
      setClipFormats(Object.fromEntries(event.clips.map((_, i) => [i, "9:16" as ExportFormat])));
      // All clips start unsaved — the user decides what enters their library.
      setClipStatus(Object.fromEntries(event.clips.map((_, i) => [i, "unsaved" as const])));
      setAnalyzedUrl(sourceRef);
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

  const analyze = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (inputMode === "file" ? !uploadedFile : !url) return;

    setLoading(true);
    setError(null);
    setClips(null);
    setStages({ ...INITIAL_STAGES });
    setEtaRemaining(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          inputMode === "file" && uploadedFile
            ? { uploadId: uploadedFile.id, durationHint: uploadedFile.durationSeconds }
            : { url, durationHint: previewDuration ?? undefined }
        ),
      });

      // Validation failures come back as plain JSON before the stream starts.
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }

      // Read the SSE stream: events arrive as "data: {...}\n\n" frames.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            handleEvent(JSON.parse(dataLine.slice(6)) as AnalyzeEvent);
          }
        }
      }
    } catch {
      setError("Connection lost — is the dev server still running?");
    } finally {
      // Brief pause so the final "Done!" check is visible before closing.
      setTimeout(() => setLoading(false), 1200);
    }
  };

  /** Render one clip via /api/clip and return the MP4 blob. */
  const fetchClipBlob = async (clip: ClipWithWords, style: CaptionStyle, index: number, raw = false): Promise<Blob> => {
    const res = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        raw
          ? {
              // Raw export (Pro): clean cut, original framing, nothing burned in.
              url: analyzedUrl,
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
              handle: handle || undefined,
              hook: clipHooks[index] ?? undefined,
              // Keep the burn identical to the preview overlay (black pill bar).
              hook_style: "BOXED",
              aspect_ratio: clipFormats[index] ?? "9:16",
            }
      ),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `Clip generation failed (HTTP ${res.status}).`);
    }
    return res.blob();
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const clipFilename = (clip: ClipWithWords, index: number, raw = false) => {
    const safe = clip.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
    return (safe || `klyp_clip_${index + 1}`) + (raw ? "_raw" : "") + ".mp4";
  };

  const keepClip = (index: number) => {
    if (!clips || clipStatus[index] !== "unsaved") return;
    setClipStatus((prev) => ({ ...prev, [index]: "kept" }));
    // Non-blocking — fails silently if not logged in (same as the old auto-save).
    saveClipsToSupabase(analyzedUrl, [clips[index]]);
  };

  const discardClip = (index: number) => {
    setClipStatus((prev) => ({ ...prev, [index]: "discarded" }));
  };

  const keepAll = () => {
    if (!clips) return;
    const toKeep = clips.map((c, i) => ({ c, i })).filter(({ i }) => clipStatus[i] === "unsaved");
    if (toKeep.length === 0) return;
    setClipStatus((prev) => {
      const next = { ...prev };
      for (const { i } of toKeep) next[i] = "kept";
      return next;
    });
    saveClipsToSupabase(analyzedUrl, toKeep.map(({ c }) => c));
  };

  const downloadClip = async (clip: ClipWithWords, index: number, styleOverride?: CaptionStyle, raw = false) => {
    if (busy) return;
    setDownloading(index);
    setDownloadError(null);

    const style = styleOverride ?? clipStyles[index] ?? "BOLD";
    try {
      const blob = await fetchClipBlob(clip, style, index, raw);
      saveBlob(blob, clipFilename(clip, index, raw));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  /** Render every clip sequentially (they share the cached source video) and zip them. */
  const downloadAllAsZip = async () => {
    if (!clips || busy) return;
    setDownloadError(null);
    const total = clips.filter((_, i) => clipStatus[i] !== "discarded").length;
    if (total === 0) return;
    setZipProgress({ done: 0, total });

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const usedNames = new Set<string>();

      let done = 0;
      for (let i = 0; i < clips.length; i++) {
        if (clipStatus[i] === "discarded") continue;
        const blob = await fetchClipBlob(clips[i], clipStyles[i] ?? "BOLD", i);
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
      setZipProgress(null);
    }
  };

  return (
    <section className="mb-8">
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
                          {etaRemaining === null
                            ? "working…"
                            : etaRemaining > 0
                            ? `≈ ${etaRemaining >= 60 ? `${Math.ceil(etaRemaining / 60)} min` : `${etaRemaining}s`} remaining`
                            : "almost done…"}
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
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="font-syne text-lg font-semibold text-foreground mb-1">Analyze a VOD</h2>
        <p className="text-sm text-foreground-muted mb-4">
          Paste a YouTube/Twitch VOD URL or upload a video file. Klyp will find the 5 most clippable moments.
        </p>

        {/* Input mode toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden w-fit mb-3">
          {([["url", "Paste URL"], ["file", "Upload file"]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              disabled={loading}
              className={`px-4 py-2 text-xs font-bold font-syne transition-colors disabled:opacity-50 ${
                inputMode === mode
                  ? "bg-accent-glow text-accent"
                  : "bg-surface-2 text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={analyze} className="flex flex-col gap-3">
          {inputMode === "url" ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… or https://www.twitch.tv/videos/…"
                disabled={loading || outOfSparks}
                className="flex-1 px-4 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !url || outOfSparks || cantAfford}
                className="px-6 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none whitespace-nowrap"
              >
                {loading ? "Analyzing…" : "Find clips"}
              </button>
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
                  className={`flex flex-col items-center justify-center gap-1.5 px-6 py-10 rounded-xl border-2 border-dashed transition-colors ${
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

              <button
                type="submit"
                disabled={loading || !uploadedFile || uploadPct !== null || outOfSparks || cantAfford}
                className="px-6 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none whitespace-nowrap sm:self-start"
              >
                {loading ? "Analyzing…" : "Find clips"}
              </button>
            </>
          )}
        </form>

        {/* Streamer handle — burned into the corner of every export */}
        <div className="flex items-center gap-2 mt-3">
          <label htmlFor="klyp-handle" className="text-xs text-foreground-muted whitespace-nowrap">
            Streamer handle
          </label>
          <div className="flex items-center gap-0 px-3 py-1.5 rounded-lg bg-surface-2 border border-border focus-within:border-accent transition-colors">
            <span className="text-xs text-subtle">@</span>
            <input
              id="klyp-handle"
              type="text"
              value={handle}
              onChange={(e) => updateHandle(e.target.value)}
              placeholder="yourname"
              disabled={loading}
              className="w-32 bg-transparent text-xs text-foreground placeholder:text-subtle focus:outline-none disabled:opacity-50"
            />
          </div>
          <span className="text-[10px] text-subtle">
            {handle ? `@${handle} will be burned into your clips` : "optional — shown in the clip corner"}
          </span>
        </div>

        {/* Sparks cost preview */}
        {!outOfSparks && (estimating || estimatedSparks !== null) && (
          <div className="flex items-center gap-1.5 mt-3 text-sm">
            <SparkIcon size={13} className="text-accent" />
            {estimating ? (
              <span className="text-foreground-muted">Checking video length…</span>
            ) : (
              <span className="text-foreground-muted">
                This VOD will use approximately{" "}
                <span className={`font-syne font-bold ${cantAfford ? "text-red-400" : "text-accent"}`}>
                  {estimatedSparks} Sparks
                </span>
                {cantAfford && (
                  <span className="text-red-400">
                    {" "}— you only have {balance}.{" "}
                    <a href="/dashboard/upgrade" className="underline">Upgrade to Pro</a> for more ⚡
                  </span>
                )}
              </span>
            )}
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
          <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {clips && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h3 className="font-syne text-base font-semibold text-foreground">
              Top {clips.length} clippable moments
            </h3>
            <div className="flex items-center gap-2">
            <button
              onClick={keepAll}
              disabled={busy || !clips.some((_, i) => clipStatus[i] === "unsaved")}
              title="Save every remaining clip to My Clips"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-background text-xs font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Keep all
            </button>
            <button
              onClick={downloadAllAsZip}
              disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-accent/40 text-accent text-xs font-bold font-syne hover:bg-accent-glow transition-colors disabled:opacity-50"
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

          {downloadError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {downloadError}
            </div>
          )}
          {clips.every((_, i) => clipStatus[i] === "discarded") && (
            <p className="text-sm text-foreground-muted text-center py-8">
              All clips discarded. Analyze another VOD to find more moments.
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {clips.map((clip, i) => clipStatus[i] === "discarded" ? null : (
              <div
                key={i}
                className="bg-surface border border-border rounded-xl p-5 hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span
                    className={`px-2.5 py-1 rounded-md border text-[11px] font-bold font-syne tracking-wide ${TYPE_STYLES[clip.type]}`}
                  >
                    {clip.type}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">viral score</span>
                    <span
                      className={`font-syne text-lg font-bold ${
                        clip.viral_score >= 85 ? "text-accent" : "text-foreground"
                      }`}
                    >
                      {Math.round(clip.viral_score)}
                    </span>
                  </div>
                </div>

                <h4 className="font-syne text-base font-semibold text-foreground mb-1.5">
                  {clip.title}
                </h4>
                <p className="text-sm text-foreground-muted mb-3">{clip.caption}</p>

                <div className="flex items-center justify-between text-xs">
                  <span className="px-2 py-1 rounded bg-surface-2 border border-border text-foreground-muted font-mono">
                    {fmtTime(clip.start_seconds)} → {fmtTime(clip.end_seconds)}
                  </span>
                  <span className="text-subtle">
                    {Math.round(clip.end_seconds - clip.start_seconds)}s clip
                    {clip.thumbnail_seconds != null && (
                      <> · thumb @ {fmtTime(clip.thumbnail_seconds)}</>
                    )}
                  </span>
                </div>

                <p className="mt-3 pt-3 border-t border-border text-xs text-foreground-muted italic">
                  {clip.reason}
                </p>

                {/* Hook options — burned over the first 3s of the export */}
                {clip.hooks && clip.hooks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted mb-2">
                      Hook Options{" "}
                      <span className="font-normal normal-case tracking-normal text-subtle">
                        — shown on screen for the first 3s
                      </span>
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {clip.hooks.map((hookText) => {
                        const selected = clipHooks[i] === hookText;
                        return (
                          <button
                            key={hookText}
                            onClick={() =>
                              setClipHooks((prev) => ({ ...prev, [i]: selected ? null : hookText }))
                            }
                            disabled={busy}
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
                  </div>
                )}

                {/* Export format */}
                <div className="mt-3 flex items-center gap-2">
                  <p className="text-[10px] font-bold font-syne uppercase tracking-wider text-foreground-muted">
                    Format
                  </p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {EXPORT_FORMATS.map((f) => {
                      const locked = !isPro && f !== "9:16";
                      return (
                        <button
                          key={f}
                          onClick={() =>
                            locked ? setProGateOpen(true) : setClipFormats((prev) => ({ ...prev, [i]: f }))
                          }
                          disabled={busy}
                          title={locked ? "Format switching is a Pro feature" : FORMAT_LABELS[f]}
                          className={`px-2.5 py-1.5 text-[11px] font-bold font-syne transition-colors disabled:opacity-50 ${
                            (clipFormats[i] ?? "9:16") === f
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
                  <span className="text-[10px] text-subtle">
                    {FORMAT_LABELS[clipFormats[i] ?? "9:16"]}
                  </span>
                </div>

                {/* Preview + Export buttons */}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setPreviewIndex(i)}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-accent/40 text-accent text-sm font-bold font-syne hover:bg-accent-glow transition-colors disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Preview
                  </button>

                  <button
                    onClick={() => downloadClip(clip, i)}
                    disabled={busy}
                    title={!isPro ? "Upgrade to Pro to remove the Klyp watermark" : undefined}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold font-syne transition-colors disabled:opacity-50 ${
                      downloading === i
                        ? "bg-surface-2 border border-accent/30 text-accent"
                        : "bg-accent text-background hover:bg-accent-dim shadow-accent-glow-sm disabled:shadow-none"
                    }`}
                  >
                    {downloading === i ? (
                      <>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                        Exporting…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Export
                      </>
                    )}
                  </button>
                </div>

                {/* Raw export — clean cut, no captions/hook/crop/watermark, for CapCut & co. */}
                <button
                  onClick={() =>
                    isPro
                      ? downloadClip(clip, i, undefined, true)
                      : window.location.assign("/dashboard/upgrade")
                  }
                  disabled={busy}
                  title={
                    isPro
                      ? "Clean cut of this moment — original framing, nothing burned in — for editing in CapCut, Premiere, etc."
                      : "Upgrade to Pro to download raw clips and edit them yourself"
                  }
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border bg-surface-2 text-xs font-semibold font-syne text-foreground-muted hover:text-foreground hover:border-subtle transition-colors disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3"/>
                    <circle cx="6" cy="18" r="3"/>
                    <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                    <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                    <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                  </svg>
                  Raw export — edit it yourself
                  {!isPro && (
                    <span className="px-1.5 py-0.5 rounded bg-accent-glow text-accent text-[9px] font-bold tracking-wide">
                      PRO
                    </span>
                  )}
                </button>

                {/* Library decision — clips are only saved to My Clips when kept */}
                {clipStatus[i] === "kept" ? (
                  <div className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-accent-glow border border-accent/30 text-accent text-xs font-bold font-syne">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved to My Clips
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => keepClip(i)}
                      disabled={busy}
                      title="Save this clip to My Clips"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-accent/40 text-accent text-xs font-bold font-syne hover:bg-accent-glow transition-colors disabled:opacity-50"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Keep
                    </button>
                    <button
                      onClick={() => discardClip(i)}
                      disabled={busy}
                      title="Remove this clip — it won't be saved"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-foreground-muted text-xs font-bold font-syne hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Discard
                    </button>
                  </div>
                )}

                {!isPro && (
                  <p className="mt-1.5 text-[10px] text-subtle text-center">
                    Free tier — animated watermark added.{" "}
                    <a href="/dashboard/upgrade" className="text-accent hover:underline">Upgrade to Pro</a>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {proGateOpen && <ProGateModal onClose={() => setProGateOpen(false)} />}

      {/* ── Preview modal ── */}
      {previewIndex !== null && clips && (
        <ClipPreview
          clip={clips[previewIndex]}
          analyzedUrl={analyzedUrl}
          initialStyle={clipStyles[previewIndex] ?? "BOLD"}
          hook={clipHooks[previewIndex] ?? null}
          hookStyle="BOXED"
          exporting={downloading === previewIndex}
          onClose={() => setPreviewIndex(null)}
          onExport={(style) => {
            setClipStyles((prev) => ({ ...prev, [previewIndex]: style }));
            setPreviewIndex(null);
            downloadClip(clips[previewIndex], previewIndex, style);
          }}
        />
      )}
    </section>
  );
}
