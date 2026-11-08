/**
 * The email the owner gets for each message from the "Something wrong?" button. Replying to it goes straight to the
 * person who wrote (Reply-To is their address). Pure: it only builds strings.
 */
import { feedbackReasonLabel, shortBrowser } from "./feedback.ts";

export type FeedbackRow = {
  id: string; user_id: string; reason: string; message: string;
  page: string | null; user_agent: string | null; created_at: string;
};
export type FeedbackContext = {
  email: string | null;
  plan: "free" | "pro";
  sparks: number | null;
  lastVideo: { platform: string; status: string; error: string | null; at: string } | null;
};
export type FeedbackEmail = { subject: string; html: string; text: string; replyTo: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function buildFeedbackEmail(row: FeedbackRow, context: FeedbackContext, now = Date.now()): FeedbackEmail {
  const reason = feedbackReasonLabel(row.reason);
  const snippet = oneLine(row.message).slice(0, 60);
  const subject = `[Klyp] ${reason}: ${snippet || "(no message)"}`;
  const last = context.lastVideo
    ? `${context.lastVideo.platform}, ${context.lastVideo.status}, ${ago(context.lastVideo.at, now)}${context.lastVideo.error ? `, error: ${oneLine(context.lastVideo.error).slice(0, 200)}` : ""}`
    : "none yet";
  const details: [string, string][] = [
    ["From", context.email ?? "unknown (no email on the account)"],
    ["Reason", reason],
    ["Plan", context.plan === "pro" ? "Pro" : "Free"],
    ["Sparks", context.sparks === null ? "unknown" : String(Math.floor(context.sparks))],
    ["Page", row.page ?? "unknown"],
    ["Last video", last],
    ["Browser", shortBrowser(row.user_agent)],
    ["Sent", ago(row.created_at, now)],
  ];

  const message = row.message.trim() || "(They picked a reason and left the box empty.)";
  const rows = details.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#777777;font-size:13px;vertical-align:top;">${esc(k)}</td><td style="padding:3px 0;color:#222222;font-size:13px;">${esc(v)}</td></tr>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:10px;padding:22px;">
    <p style="margin:0 0 6px;font-size:12px;color:#777777;">New message from the "Something wrong?" button</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#111111;white-space:pre-wrap;">${esc(message)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eeeeee;padding-top:10px;width:100%;">${rows}</table>
    <p style="margin:16px 0 0;font-size:12px;color:#777777;">Reply to this email to answer them directly.</p>
  </div>
</body></html>`;
  const text = `New message from the "Something wrong?" button

${message}

${details.map(([k, v]) => `${k}: ${v}`).join("\n")}

Reply to this email to answer them directly.`;
  return { subject, html, text, replyTo: context.email };
}
