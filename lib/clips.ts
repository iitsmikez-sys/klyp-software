import { z } from "zod";

/** Word-level timestamp from AssemblyAI (milliseconds). */
export type TimedWord = { text: string; start: number; end: number };

export const CAPTION_STYLES = ["BOLD", "CLEAN", "KLYP"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

/** Export aspect ratios: TikTok/Reels/Shorts, Instagram feed, YouTube/LinkedIn — plus Original (no crop). */
export const EXPORT_FORMATS = ["9:16", "1:1", "16:9", "Original"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Fixed output dimensions per cropped format — "Original" keeps the source's native size. */
export const FORMAT_DIMENSIONS: Record<Exclude<ExportFormat, "Original">, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "16:9": { w: 1920, h: 1080 },
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  "9:16": "TikTok / Shorts",
  "1:1": "IG Feed",
  "16:9": "YouTube",
  Original: "No crop — source aspect ratio",
};

/**
 * The clip categories Klyp's analysis brain (MIDAS) assigns.
 * Keep in sync with the prompt in app/api/analyze/route.ts
 * and the badge colors in components/AnalyzePanel.tsx / lib/clip-ui.ts.
 * (UNHINGED / HIGHLIGHT are legacy types — old saved clips may still carry them.)
 */
export const CLIP_TYPES = ["CLUTCH", "FUNNY", "RAGE", "EPIC", "FAIL", "BIG_BRAIN", "EMOTIONAL", "SUS"] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/**
 * The 6 detection signals MIDAS scans the transcript for.
 * Keep in sync with the prompt in app/api/analyze/route.ts.
 */
export const CLIP_SIGNALS = [
  "REACTION_SPIKE",
  "CHAT_EXPLOSION",
  "UNEXPECTED_TURN",
  "CONFLICT",
  "RELATABLE_QUOTABLE",
  "CHAOS",
] as const;
export type ClipSignal = (typeof CLIP_SIGNALS)[number];

/** One clippable moment identified by Claude. */
export const ClipSchema = z.object({
  start_seconds: z.number().describe("Clip start time in seconds from the beginning of the VOD"),
  end_seconds: z.number().describe("Clip end time in seconds from the beginning of the VOD"),
  type: z
    .enum(CLIP_TYPES)
    .describe("The clip category — exactly one of the 8 clip types (CLUTCH/FUNNY/RAGE/EPIC/FAIL/BIG_BRAIN/EMOTIONAL/SUS). Never a signal name."),
  signals: z
    .array(z.enum(CLIP_SIGNALS))
    .min(1)
    .describe("The detection signal(s) that triggered this clip, most dominant first — signal names only, never a clip type"),
  viral_score: z.number().describe("Estimated viral potential from 0 to 100"),
  title: z.string().describe("A short, punchy, clickable title for the clip"),
  caption: z.string().describe("A social-media-ready caption with relevant hashtags"),
  reason: z.string().describe("One sentence explaining why this moment is clippable"),
  hooks: z
    .array(z.string())
    .min(3)
    .max(3)
    .describe("Exactly 3 alternative reaction/callout hook lines burned on-screen (e.g. 'RAKAI CRASHED OUT') — each under 8 words"),
  thumbnail_seconds: z
    .number()
    .describe("Timestamp in seconds (within the clip) of the most expressive frame to use as the thumbnail"),
});

export const ClipAnalysisSchema = z.object({
  clips: z
    .array(ClipSchema)
    .max(20)
    .describe("The best clippable moments (up to the requested count, only those above the quality floor), ordered by viral_score descending"),
});

export type Clip = z.infer<typeof ClipSchema>;
export type ClipAnalysis = z.infer<typeof ClipAnalysisSchema>;

/** Clip enriched with per-clip word timestamps (added after Claude analysis, not in schema). */
export type ClipWithWords = Clip & { words: TimedWord[] };

/** Shape of the /api/analyze response. */
export type AnalyzeResponse =
  | { ok: true; clips: Clip[]; durationSeconds: number; transcriptChars: number }
  | { ok: false; error: string; stage: "validate" | "download" | "transcribe" | "analyze" };

/** Pipeline stages reported over the SSE stream. */
export type AnalyzeStage = "download" | "transcribe" | "analyze";

/** Events streamed by POST /api/analyze (Server-Sent Events). */
export type AnalyzeEvent =
  | { type: "progress"; stage: AnalyzeStage; status: "running" | "done"; etaSeconds?: number }
  | {
      type: "result";
      clips: ClipWithWords[];
      durationSeconds: number;
      transcriptChars: number;
      /** How many clips the user asked for — fewer may return (quality floor). */
      requestedClips: number;
      /** Sparks deducted for this analysis and the balance after (server-authoritative). */
      sparksSpent: number;
      sparksBalance: number;
    }
  | { type: "error"; stage: AnalyzeStage | "validate"; error: string };
