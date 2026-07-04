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
  UNHINGED: "bg-fuchsia-400",
  HIGHLIGHT: "bg-accent",
};

export const CLIP_TYPE_ORDER = [
  "CLUTCH", "FUNNY", "RAGE", "EPIC", "FAIL", "BIG_BRAIN", "EMOTIONAL", "SUS",
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

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
