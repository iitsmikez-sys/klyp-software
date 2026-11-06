/**
 * GET|POST /api/activation-unsubscribe?u=<account id>&t=<code> — the link in the activation emails.
 * The code is signed (lib/activation-unsubscribe.ts), so only the link we put in the email works.
 * GET shows a small confirmation page; POST is what mail apps use for one-click unsubscribe.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribe } from "@/lib/activation-unsubscribe";

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

async function handle(req: NextRequest) {
  const secret = process.env.ACTIVATION_EMAIL_SECRET;
  if (!secret) return page("Unavailable", "This link isn't available right now.", 503);
  const userId = req.nextUrl.searchParams.get("u");
  const token = req.nextUrl.searchParams.get("t");
  if (!verifyUnsubscribe(userId, token, secret)) return page("Link not valid", "This unsubscribe link isn't valid.", 400);

  const { error } = await createAdminClient().from("profiles").update({ activation_emails_off: true }).eq("id", userId!);
  if (error) return page("Something went wrong", "We couldn't save that. Please try the link again.", 500);
  return page("Unsubscribed", "You're unsubscribed. We won't send you these tips again.", 200);
}

export const GET = handle;
export const POST = handle;
