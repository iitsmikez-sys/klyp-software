/**
 * The "your stream ended, clips are ready" email sent by automatic clipping (Pro). It lists the top moments with their scores and
 * links to the phone-friendly review page (/dashboard/review) where each clip is kept or deleted. Pure builders plus one send
 * function that takes its dependencies, so the tests never touch the network.
 */
import { unsubscribeUrl } from "./activation-unsubscribe.ts";

export type ReadyClip = { title: string; score: number };
export type ClipsReadyEmail = { subject: string; previewText: string; html: string; text: string };

const P = "margin-top:0;margin-right:0;margin-bottom:14px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;";
const BUTTON = "display:inline-block;background-color:#00e5a0;color:#0b0b0b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none;padding-top:14px;padding-right:30px;padding-bottom:14px;padding-left:30px;border-radius:10px;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const TOP_SHOWN = 3;

/** The review link carries the time the clips were made, so the page opens on exactly this stream's clips. */
export function reviewUrl(siteUrl: string, sinceIso: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/dashboard/review?since=${encodeURIComponent(sinceIso)}`;
}

export function buildClipsReadyEmail(args: { clips: ReadyClip[]; reviewUrl: string; unsubscribeUrl: string }): ClipsReadyEmail {
  const total = args.clips.length;
  const top = [...args.clips].sort((a, b) => b.score - a.score).slice(0, TOP_SHOWN);
  const subject = `Your stream ended: ${plural(total, "clip")} ${total === 1 ? "is" : "are"} ready`;
  const previewText = top[0] ? `Best one: ${clean(top[0].title)}` : "Review them in about 2 minutes.";
  const intro = `Klyp found ${plural(total, "clip")} in your last stream.${top.length ? ` The top ${top.length === 1 ? "one" : top.length}:` : ""}`;
  const lines = top.map((c) => `${clean(c.title)} (score ${Math.round(c.score)})`);
  const outro = "Keep the ones you like and delete the rest. It takes about 2 minutes on your phone.";

  const listHtml = top.map((c) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1a1a1a;padding-top:6px;padding-bottom:6px;"><strong>&ldquo;${esc(clean(c.title))}&rdquo;</strong> <span style="color:#666666;font-size:13px;">score ${Math.round(c.score)}</span></div>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f2f2f2;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(previewText)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f2f2" style="background-color:#f2f2f2;">
      <tr>
        <td align="center" style="padding-top:24px;padding-right:12px;padding-bottom:24px;padding-left:12px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:480px;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
            <tr><td align="center" bgcolor="#0b0b0b" style="background-color:#0b0b0b;padding-top:18px;padding-right:18px;padding-bottom:18px;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;">kl<span style="color:#00e5a0;">yp</span></td></tr>
            <tr>
              <td style="padding-top:26px;padding-right:28px;padding-bottom:8px;padding-left:28px;">
                <p style="${P}">${esc(intro)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;"><tr><td bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding-top:8px;padding-right:14px;padding-bottom:8px;padding-left:14px;border-radius:8px;">${listHtml}</td></tr></table>
                <p style="${P}">${esc(outro)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:0;padding-right:28px;padding-bottom:26px;padding-left:28px;">
                <a href="${esc(args.reviewUrl)}" style="${BUTTON}">Review my clips</a>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding-top:14px;padding-right:28px;padding-bottom:14px;padding-left:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">
                <a href="${esc(args.unsubscribeUrl)}" style="color:#777777;text-decoration:underline;">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [intro, "", ...lines.map((l) => `- ${l}`), "", outro, "", `Review my clips: ${args.reviewUrl}`, "", `Unsubscribe: ${args.unsubscribeUrl}`].join("\n");
  return { subject, previewText, html, text };
}

export type ClipsReadyDeps = {
  /** The account's email address, and whether they have switched Klyp's emails off. */
  getRecipient(userId: string): Promise<{ email: string | null; emailsOff: boolean } | null>;
  send(mail: { to: string; subject: string; html: string; text: string; unsubscribeUrl: string }): Promise<void>;
  log(message: string): void;
};

/**
 * Sends the email for one finished automatic-clipping job. Never throws: a failed email must not undo or retry the clipping.
 * Off with CLIPS_READY_EMAILS=off, and quietly skipped when the account switched emails off or there are no clips.
 */
export async function sendClipsReady(
  deps: ClipsReadyDeps,
  args: { userId: string; clips: ReadyClip[]; sinceIso: string; siteUrl: string; secret: string | undefined; mode: string | undefined },
): Promise<"sent" | "skipped"> {
  try {
    if (args.mode === "off" || !args.secret || args.clips.length === 0) return "skipped";
    const recipient = await deps.getRecipient(args.userId);
    if (!recipient?.email || recipient.emailsOff) return "skipped";
    const unsub = unsubscribeUrl(args.siteUrl, args.userId, args.secret);
    const mail = buildClipsReadyEmail({ clips: args.clips, reviewUrl: reviewUrl(args.siteUrl, args.sinceIso), unsubscribeUrl: unsub });
    await deps.send({ to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: unsub });
    deps.log(`sent to ${args.userId}: ${args.clips.length} clips`);
    return "sent";
  } catch (err) {
    deps.log(`could not send to ${args.userId}: ${err instanceof Error ? err.message : String(err)}`);
    return "skipped";
  }
}
