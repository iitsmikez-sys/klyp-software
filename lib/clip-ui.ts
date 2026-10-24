/** Shared UI helpers for clip lists across dashboard pages. */
import type { TimedWord } from "@/lib/clips";

export interface SavedClip {
  id: string;
  url: string;
  title: string;
  clip_type: string;
  viral_score: number;
  caption: string | null;
  reason: string | null;
  start_seconds: number;
  end_seconds: number;
  created_at: string;
  /** Hook options / word timestamps — null on clips saved before migration 003. */
  hooks?: string[] | null;
  words?: TimedWord[] | null;
  /** Saved editing choices; the analyzed clip fields remain unchanged. */
  edit_draft?: unknown;
  /**
   * How this clip's own footage is held: "stored" once archived, "unavailable"
   * when the source VOD is gone and nothing was archived in time, "pending" or
   * "failed" mid-archive. Null on clips from before migration 008.
   */
  archive_status?: string | null;
  /** Five 0-20 dimension scores — null on clips saved before migration 009. */
  dim_hype?: number | null;
  dim_emotion?: number | null;
  dim_skill?: number | null;
  dim_comedy?: number | null;
  dim_storyline?: number | null;
}

/**
 * What a viral score actually means, in words.
 *
 * The raw number misleads on its own. Analysis never returns a clip scoring
 * below 65 (the quality floor in analyze-pipeline) and then keeps only the top
 * few of each VOD, so the scale a streamer sees is roughly 65-100, not 0-100.
 * Read as a percentage, a 72 looks like a failing grade; it is in fact a solid
 * clip that cleared the floor. These bands say so directly.
 */
export type ScoreBand = { label: string; blurb: string; className: string };

export function scoreBand(score: number): ScoreBand {
  if (score >= 85) return {
    label: "Must post",
    blurb: "Rare — most VODs have none of these.",
    className: "bg-accent-glow text-accent border-accent/30",
  };
  if (score >= 75) return {
    label: "Strong",
    blurb: "Any editor would post this.",
    className: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  };
  if (score >= 68) return {
    label: "Solid",
    blurb: "Worth posting, not remarkable.",
    className: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  };
  return {
    label: "Marginal",
    blurb: "Only just cleared the quality floor.",
    className: "bg-surface-2 text-muted border-border",
  };
}

/** The five dimensions in display order, or null when this clip has none. */
export function clipDimensions(
  clip: Pick<SavedClip, "dim_hype" | "dim_emotion" | "dim_skill" | "dim_comedy" | "dim_storyline">
): { label: string; value: number }[] | null {
  const dims = [
    { label: "Hype", value: clip.dim_hype },
    { label: "Emotion", value: clip.dim_emotion },
    { label: "Skill", value: clip.dim_skill },
    { label: "Comedy", value: clip.dim_comedy },
    { label: "Story", value: clip.dim_storyline },
  ];
  // All-or-nothing: a partial breakdown would imply zeros that were never scored.
  if (dims.some((d) => typeof d.value !== "number")) return null;
  return dims as { label: string; value: number }[];
}

/**
 * True when there is no footage left anywhere for this clip — the source VOD
 * has been deleted and no archive was made. Nothing can render it, so the UI
 * says so instead of offering a preview or export that is certain to fail.
 */
export function footageGone(clip: { archive_status?: string | null }): boolean {
  return clip.archive_status === "unavailable";
}

/** Badge colors per clip type — keep in sync with AnalyzePanel.
 * UNHINGED / HIGHLIGHT are legacy types kept so old saved clips still render. */
export const TYPE_STYLES: Record<string, string> = {
  CLUTCH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FUNNY: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  RAGE: "bg-red-500/15 text-red-400 border-red-500/30",
  EPIC: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  FAIL: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  BIG_BRAIN: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  EMOTIONAL: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  SUS: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  // IRL-only types
  STORY_TIME: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  AWKWARD: "bg-lime-500/15 text-lime-400 border-lime-500/30",
  PUBLIC_INTERACTION: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  UNHINGED: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  HIGHLIGHT: "bg-accent-glow text-accent border-accent/30",
};

/** Solid bar colors per clip type (for analytics charts). */
export const TYPE_BAR_COLORS: Record<string, string> = {
  CLUTCH: "bg-amber-400",
  FUNNY: "bg-sky-400",
  RAGE: "bg-red-400",
  EPIC: "bg-violet-400",
  FAIL: "bg-orange-400",
  BIG_BRAIN: "bg-emerald-400",
  EMOTIONAL: "bg-rose-400",
  SUS: "bg-fuchsia-400",
  // IRL-only types
  STORY_TIME: "bg-teal-400",
  AWKWARD: "bg-lime-400",
  PUBLIC_INTERACTION: "bg-indigo-400",
  UNHINGED: "bg-fuchsia-400",
  HIGHLIGHT: "bg-accent",
};

export const CLIP_TYPE_ORDER = [
  "CLUTCH", "FUNNY", "RAGE", "EPIC", "FAIL", "BIG_BRAIN", "EMOTIONAL", "SUS",
  // IRL-only
  "STORY_TIME", "AWKWARD", "PUBLIC_INTERACTION",
  // legacy
  "UNHINGED", "HIGHLIGHT",
];

export function fmtTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function platformName(url: string): "Twitch" | "YouTube" | "VOD" {
  try {
    const host = new URL(url).hostname;
    if (host.includes("twitch")) return "Twitch";
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
  } catch { /* fall through */ }
  return "VOD";
}

/** Deep-link into the source VOD at a clip's start time. */
export function vodLinkAt(url: string, startSeconds: number): string {
  const s = Math.max(0, Math.floor(startSeconds));
  const platform = platformName(url);
  if (platform === "Twitch") {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${url}${url.includes("?") ? "&" : "?"}t=${h}h${m}m${sec}s`;
  }
  if (platform === "YouTube") {
    return `${url}${url.includes("?") ? "&" : "?"}t=${s}s`;
  }
  return url;
}

/** Clip length in seconds, clamped at 0 for any malformed row. */
export function clipDuration(clip: Pick<SavedClip, "start_seconds" | "end_seconds">): number {
  return Math.max(0, clip.end_seconds - clip.start_seconds);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
