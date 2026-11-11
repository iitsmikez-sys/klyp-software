/**
 * What each plan says it includes, in one place. The landing page's pricing cards and the in-app upgrade page both read these
 * lists, so they can no longer say different things. Every number comes from the app's own rules (Sparks, hours, caption styles).
 */
import { SPARKS_ALLOWANCE } from "./tier.ts";
import { PLAN_LIMITS } from "./plan-limits.ts";
import { CAPTION_STYLES, FREE_CAPTION_STYLES, type CaptionStyle } from "./clips.ts";

/** How each free caption style is named for people. Adding a free style without a name here fails a test. */
export const FREE_STYLE_NAMES: Partial<Record<CaptionStyle, string>> = {
  BOLD: "Bold",
  KLYP: "Klyp",
  SPARK: "Spark",
  PULSE: "Pulse",
  HIGHLIGHTER: "Highlighter",
};

const names = FREE_CAPTION_STYLES.map((style) => FREE_STYLE_NAMES[style] ?? style);
const freeCaptionList = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const freeHours = PLAN_LIMITS.free.youtube / 3600;
const proHours = PLAN_LIMITS.pro.youtube / 3600;

export const FREE_FEATURES: { ok: boolean; text: string }[] = [
  { ok: true, text: `${SPARKS_ALLOWANCE.free} Sparks every 30 days` },
  { ok: true, text: "AI clipping with Virality Score" },
  { ok: true, text: "Clip editor: trim, split and edit captions" },
  { ok: true, text: "9:16 vertical and Original (no crop) exports" },
  { ok: true, text: `AI captions: ${freeCaptionList}` },
  { ok: true, text: "Save clips to your library" },
  { ok: true, text: `YouTube, Twitch and Kick videos up to ${freeHours} hours` },
  { ok: false, text: "No direct video uploads or automatic clipping (Pro)" },
  { ok: false, text: "Animated Klyp watermark on free exports" },
];

/** `pro` marks a line that gets the Pro diamond instead of a check; `soon` marks a feature that is not live yet. */
export const PRO_FEATURES: { text: string; pro?: boolean; soon?: boolean }[] = [
  { text: `${SPARKS_ALLOWANCE.pro} Sparks every 30 days` },
  { text: "AI clipping with Virality Score" },
  { text: "No watermark. Clean clips, your brand only" },
  { text: "Full editor" },
  { text: `${CAPTION_STYLES.length - FREE_CAPTION_STYLES.length} more caption styles`, pro: true },
  { text: "All export formats: 9:16, Original, 1:1 and 16:9" },
  { text: "Raw exports: edit clips yourself in CapCut" },
  { text: "Streamer handle overlay on exports" },
  { text: `Longer videos from Twitch, Kick and YouTube (up to ${proHours} hours), plus direct video uploads` },
  { text: "Automatic clipping when your Twitch stream ends" },
  { text: "Twitch chat spike detection" },
  { text: "Download all clips as ZIP" },
  { text: "Post scheduling to YouTube", soon: true },
  { text: "Priority support" },
];
