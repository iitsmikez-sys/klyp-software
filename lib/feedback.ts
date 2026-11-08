/** The "Something wrong?" button: the reasons people can pick and the limits on what they send. Pure. */
export const FEEDBACK_REASONS = [
  { key: "clips", label: "The clips weren't good" },
  { key: "broke", label: "Something broke" },
  { key: "billing", label: "Billing" },
  { key: "idea", label: "I have an idea" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["key"];
export const MAX_FEEDBACK_MESSAGE = 2000;

export const isFeedbackReason = (value: string | null | undefined): value is FeedbackReason =>
  FEEDBACK_REASONS.some((reason) => reason.key === value);

export const feedbackReasonLabel = (key: string): string => FEEDBACK_REASONS.find((reason) => reason.key === key)?.label ?? key;

/** A short, readable browser name from the user agent text, for the email ("Chrome on Windows"). */
export function shortBrowser(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "unknown browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
  const system = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}
