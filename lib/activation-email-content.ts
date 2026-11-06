/** The wording of the two activation emails (approved as mockups). Pure: it only builds strings. */
import type { ActivationKind } from "./activation-email-rules.ts";

export type ActivationEmail = { subject: string; previewText: string; html: string; text: string };

const SUBJECTS: Record<ActivationKind, { subject: string; preview: string }> = {
  first: { subject: "You're in. Your 60 free Sparks are ready", preview: "Paste one stream link and see your best moments in minutes." },
  second: { subject: "Got a VOD sitting around?", preview: "Every stream hides a few moments worth posting." },
};

const P = "margin-top:0;margin-right:0;margin-bottom:14px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;";
const BUTTON = "display:inline-block;background-color:#00e5a0;color:#0b0b0b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none;padding-top:14px;padding-right:30px;padding-bottom:14px;padding-left:30px;border-radius:10px;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildActivationEmail(kind: ActivationKind, links: { dashboardUrl: string; unsubscribeUrl: string }): ActivationEmail {
  const { subject, preview } = SUBJECTS[kind];
  const dashboard = esc(links.dashboardUrl);
  const unsub = esc(links.unsubscribeUrl);

  const header = kind === "first"
    ? `<tr><td align="center" bgcolor="#0b0b0b" style="background-color:#0b0b0b;padding-top:18px;padding-right:18px;padding-bottom:18px;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;">kl<span style="color:#00e5a0;">yp</span></td></tr>`
    : "";

  const body = kind === "first"
    ? `<p style="${P}">Welcome to Klyp. Your 60 free Sparks are ready.</p>
                <p style="margin-top:0;margin-right:0;margin-bottom:6px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;font-weight:bold;color:#1a1a1a;">Takes about two minutes:</p>
                <ul style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;">
                  <li style="margin-bottom:6px;">Paste a Twitch, Kick, or YouTube link.</li>
                  <li style="margin-bottom:6px;">Klyp finds the best moments.</li>
                  <li>Download them, ready to post.</li>
                </ul>`
    : `<p style="${P}">Every stream hides a few moments worth posting. Your 60 free Sparks are still waiting, enough to try a video or two.</p>
                <p style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;">Not sure what to paste? Any recent VOD works. If something got in your way, just reply and tell us.</p>`;

  const noCard = kind === "first"
    ? `<tr><td align="center" style="padding-top:0;padding-right:28px;padding-bottom:22px;padding-left:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">No card needed.</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f2f2f2;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preview)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f2f2" style="background-color:#f2f2f2;">
      <tr>
        <td align="center" style="padding-top:24px;padding-right:12px;padding-bottom:24px;padding-left:12px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:480px;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
            ${header}
            <tr>
              <td style="padding-top:26px;padding-right:28px;padding-bottom:8px;padding-left:28px;">
                ${body}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:0;padding-right:28px;padding-bottom:${kind === "first" ? "8" : "22"}px;padding-left:28px;">
                <a href="${dashboard}" style="${BUTTON}">Clip my first video</a>
              </td>
            </tr>
            ${noCard}
            <tr>
              <td style="padding-top:0;padding-right:28px;padding-bottom:26px;padding-left:28px;">
                <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#333333;">The Klyp team</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding-top:14px;padding-right:28px;padding-bottom:14px;padding-left:28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">
                <a href="${unsub}" style="color:#777777;text-decoration:underline;">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = kind === "first"
    ? `klyp

Welcome to Klyp. Your 60 free Sparks are ready.

Takes about two minutes:

 * Paste a Twitch, Kick, or YouTube link.
 * Klyp finds the best moments.
 * Download them, ready to post.

Clip my first video: ${links.dashboardUrl}
No card needed.

The Klyp team

Unsubscribe: ${links.unsubscribeUrl}`
    : `Every stream hides a few moments worth posting. Your 60 free Sparks are still waiting, enough to try a video or two.

Not sure what to paste? Any recent VOD works. If something got in your way, just reply and tell us.

Clip my first video: ${links.dashboardUrl}

The Klyp team

Unsubscribe: ${links.unsubscribeUrl}`;

  return { subject, previewText: preview, html, text };
}
