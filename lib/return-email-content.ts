/** The follow-up email for people who tried Klyp once and did not come back (approved as a mockup). Pure: builds strings. */
import { RETURN_REASONS } from "./return-feedback.ts";

export type ReturnEmailData = { clipCount: number; bestTitle: string; bestScore: number; bestSeconds: number; daysLeft: number; sparksLeft: number };
export type ReturnEmailLinks = {
  dashboardUrl: string;
  unsubscribeUrl: string;
  reasonLinks: { key: string; label: string; url: string }[];
};
export type ReturnEmail = { subject: string; previewText: string; html: string; text: string };

const P = "margin-top:0;margin-right:0;margin-bottom:14px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;";
const BUTTON = "display:inline-block;background-color:#00e5a0;color:#0b0b0b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none;padding-top:14px;padding-right:30px;padding-bottom:14px;padding-left:30px;border-radius:10px;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildReturnEmail(data: ReturnEmailData, links: ReturnEmailLinks): ReturnEmail {
  const score = Math.round(data.bestScore);
  const title = clean(data.bestTitle) || "your best moment";
  const subject = `Your best Klyp clip scored ${score}`;
  const previewText = `You still have ${data.sparksLeft} Sparks to use.`;
  const found = `Klyp found ${plural(data.clipCount, "moment")} in your video. The best one:`;
  const saved = `Your clips are saved for ${plural(data.daysLeft, "more day")}. You also still have ${data.sparksLeft} Sparks, enough to run another video.`;
  const detail = `Score ${score}. ${fmt(data.bestSeconds)}.`;
  const ask = "Not what you hoped for? Tell us why in one click:";
  const reply = "Or just reply to this email. We read every reply.";

  const reasonHtml = links.reasonLinks
    .map((r) => `<a href="${esc(r.url)}" style="color:#333333;text-decoration:underline;">${esc(r.label)}</a>`)
    .join('<br />');

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
                <p style="${P}">${esc(found)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;"><tr><td bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding-top:12px;padding-right:14px;padding-bottom:12px;padding-left:14px;border-radius:8px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:bold;color:#1a1a1a;">&ldquo;${esc(title)}&rdquo;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#666666;">${esc(detail)}</div>
                </td></tr></table>
                <p style="${P}">${esc(saved)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:0;padding-right:28px;padding-bottom:8px;padding-left:28px;">
                <a href="${esc(links.dashboardUrl)}" style="${BUTTON}">See my clips</a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:0;padding-right:28px;padding-bottom:22px;padding-left:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">Or run another video</td>
            </tr>
            <tr>
              <td style="padding-top:0;padding-right:28px;padding-bottom:26px;padding-left:28px;">
                <p style="margin-top:0;margin-right:0;margin-bottom:8px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#333333;">${esc(ask)}</p>
                <p style="margin-top:0;margin-right:0;margin-bottom:14px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:26px;color:#333333;">${reasonHtml}</p>
                <p style="${P}">${esc(reply)}</p>
                <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;">The Klyp team</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding-top:14px;padding-right:28px;padding-bottom:14px;padding-left:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">
                <a href="${esc(links.unsubscribeUrl)}" style="color:#777777;text-decoration:underline;">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `klyp

${found}

"${title}"
${detail}

${saved}

See my clips: ${links.dashboardUrl}

${ask}
${links.reasonLinks.map((r) => ` * ${r.label}: ${r.url}`).join("\n")}

${reply}

The Klyp team

Unsubscribe: ${links.unsubscribeUrl}`;

  return { subject, previewText, html, text };
}

export const RETURN_REASON_KEYS = RETURN_REASONS.map((r) => r.key);
