/**
 * What each plan may import and run. One place, enforced on the server by every route
 * that accepts a VOD (analysis, uploads, auto-clipping) — the UI only mirrors it.
 *
 * Duration limits and Sparks balances are separate restrictions: a video inside its plan
 * limit still needs enough Sparks, and the per-run provider budget (lib/vod-budget.ts)
 * can still refuse a very long full-transcript video on its own.
 */
import { hasProAccess, type Profile } from "./tier.ts";

export type PlanName = "free" | "pro";
export type SourceKind = "youtube" | "twitch" | "upload";

const HOUR = 3600;

export const PLAN_LIMITS = {
  // Free has 60 Sparks and anything from 2 hours up costs 65, so 2 hours is the longest video a Free
  // account can actually run, for either source.
  free: { youtube: 2 * HOUR, twitch: 2 * HOUR, upload: 0, autoClip: false },
  pro: { youtube: 8 * HOUR, twitch: 8 * HOUR, upload: 8 * HOUR, autoClip: true },
} as const satisfies Record<PlanName, { youtube: number; twitch: number; upload: number; autoClip: boolean }>;

/** Pro needs a real subscription or complimentary access — the raw tier flag alone is not trusted. */
export function planOf(profile: Pick<Profile, "tier" | "stripe_subscription_id" | "complimentary_pro">): PlanName {
  return hasProAccess(profile) ? "pro" : "free";
}

/** "youtube:abc…" / "twitch:123" / "upload:xyz" (lib/vod-source.ts) -> the import method. */
export function sourceKindOf(sourceKey: string | null | undefined): SourceKind | null {
  if (!sourceKey) return null;
  const at = sourceKey.indexOf(":");
  if (at < 1 || at === sourceKey.length - 1) return null; // needs a prefix AND an id
  const prefix = sourceKey.slice(0, at);
  return prefix === "youtube" || prefix === "twitch" || prefix === "upload" ? prefix : null;
}

export const maxSecondsFor = (plan: PlanName, kind: SourceKind): number => PLAN_LIMITS[plan][kind];
export const uploadsAllowed = (plan: PlanName): boolean => PLAN_LIMITS[plan].upload > 0;
export const autoClipAllowed = (plan: PlanName): boolean => PLAN_LIMITS[plan].autoClip;

const hoursText = (seconds: number) => {
  const h = seconds / HOUR;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
};
const lengthText = (seconds: number) => {
  const h = Math.floor(seconds / HOUR);
  const m = Math.floor((seconds % HOUR) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const KIND_LABEL: Record<SourceKind, string> = { youtube: "YouTube videos", twitch: "Twitch VODs", upload: "uploaded videos" };

export const UPLOAD_PRO_MESSAGE =
  "Uploading your own video is a Pro feature. Upgrade to Pro, or paste a YouTube or Twitch link instead.";
export const AUTO_CLIP_PRO_MESSAGE = "Automatic clipping is a Pro feature. Upgrade to Pro to turn it on.";

export type LimitCheck = { ok: true } | { ok: false; status: number; message: string };

/**
 * Whether a video of `seconds` may be imported by this plan from this source.
 * Uploads are refused for Free outright (403); an over-long video is 413.
 */
export function checkSourceLimit(plan: PlanName, kind: SourceKind, seconds: number): LimitCheck {
  if (kind === "upload" && !uploadsAllowed(plan)) return { ok: false, status: 403, message: UPLOAD_PRO_MESSAGE };
  const max = maxSecondsFor(plan, kind);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, status: 400, message: "Couldn't read this video's length." };
  }
  if (seconds <= max + 30) return { ok: true }; // 30s slack: probe and encoder lengths differ slightly
  const upgrade = plan === "free"
    ? ` Pro supports ${KIND_LABEL[kind]} up to ${hoursText(PLAN_LIMITS.pro[kind])}.`
    : "";
  return {
    ok: false,
    status: 413,
    message: `The ${plan === "free" ? "Free" : "Pro"} plan supports ${KIND_LABEL[kind]} up to ${hoursText(max)}; this one is ${lengthText(seconds)}.${upgrade}`,
  };
}

/** What the dashboard shows for a pasted link or file before analysis starts. */
export function describeLimits(plan: PlanName) {
  return {
    plan,
    youtubeMaxSeconds: PLAN_LIMITS[plan].youtube,
    twitchMaxSeconds: PLAN_LIMITS[plan].twitch,
    uploadMaxSeconds: PLAN_LIMITS[plan].upload,
    uploadsAllowed: uploadsAllowed(plan),
    autoClipAllowed: autoClipAllowed(plan),
  };
}

/**
 * Which Claude model picks the clip-worthy moments in a VOD. Free and Pro both use Sonnet 5.5, which found the
 * same big moments as Opus 4.8 in side-by-side tests at roughly 40% of the cost. Change either plan without a
 * code change: set FREE_ANALYSIS_MODEL or PRO_ANALYSIS_MODEL to one of the models below (for example
 * PRO_ANALYSIS_MODEL=claude-opus-4-8 puts Pro back on Opus).
 */
export const PRO_ANALYSIS_MODEL = "claude-sonnet-5-5";
export const FREE_ANALYSIS_MODEL = "claude-sonnet-5-5";
export const ANALYSIS_MODELS = ["claude-opus-4-8", "claude-opus-5-5", "claude-sonnet-5-5"] as const;

export function analysisModelFor(isPro: boolean, env: Record<string, string | undefined> = process.env): string {
  const override = (isPro ? env.PRO_ANALYSIS_MODEL : env.FREE_ANALYSIS_MODEL)?.trim();
  if (override && (ANALYSIS_MODELS as readonly string[]).includes(override)) return override;
  return isPro ? PRO_ANALYSIS_MODEL : FREE_ANALYSIS_MODEL;
}

export type Transcriber = "assemblyai" | "groq";

/**
 * Which service turns a VOD's audio into text. TRANSCRIPTION_PROVIDER decides:
 *   "assemblyai" (or unset)  everyone uses AssemblyAI, as before
 *   "groq-free"              Free accounts use Groq's Whisper (about a fifth of the price), Pro stays on AssemblyAI
 *   "groq"                   everyone uses Groq
 * Groq is only chosen when GROQ_API_KEY is set; otherwise it stays on AssemblyAI.
 */
export function transcriberFor(isPro: boolean, env: Record<string, string | undefined> = process.env): Transcriber {
  const setting = (env.TRANSCRIPTION_PROVIDER ?? "assemblyai").trim().toLowerCase();
  if (!env.GROQ_API_KEY?.trim()) return "assemblyai";
  if (setting === "groq") return "groq";
  if (setting === "groq-free") return isPro ? "assemblyai" : "groq";
  return "assemblyai";
}
