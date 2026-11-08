/**
 * GET /api/return-feedback?u=<account id>&r=<answer>&t=<code> — the one-click answers in the follow-up email.
 * The code is signed (lib/return-feedback.ts), so only the links we put in the email work. Each person has one
 * answer; a later click replaces the earlier one. Shows a short thank-you page.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RETURN_REASONS, verifyReason } from "@/lib/return-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page = (title: string, message: string, status: number) =>
  new NextResponse(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>` +
      `<body style="margin:0;background:#0b0b0b;color:#fff;font-family:Arial,Helvetica,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;">` +
      `<div style="max-width:420px;text-align:center"><p style="font-size:22px;font-weight:bold;margin:0 0 12px">kl<span style="color:#00e5a0">yp</span></p>` +
      `<p style="font-size:16px;line-height:24px;margin:0;color:#ddd">${message}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

export async function GET(req: NextRequest) {
  const secret = process.env.ACTIVATION_EMAIL_SECRET;
  if (!secret) return page("Unavailable", "This link isn't available right now.", 503);
  const userId = req.nextUrl.searchParams.get("u");
  const reason = req.nextUrl.searchParams.get("r");
  const token = req.nextUrl.searchParams.get("t");
  if (!verifyReason(userId, reason, token, secret)) return page("Link not valid", "This link isn't valid.", 400);

  const { error } = await createAdminClient().from("return_feedback")
    .upsert({ user_id: userId!, reason, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return page("Something went wrong", "We couldn't save that. Please try the link again.", 500);
  const label = RETURN_REASONS.find((r) => r.key === reason)?.label ?? "";
  return page("Thank you", `Thanks, that helps us fix Klyp. We noted: &ldquo;${label}&rdquo;.<br /><br />Want to say more? Just reply to the email. We read every reply.`, 200);
}
