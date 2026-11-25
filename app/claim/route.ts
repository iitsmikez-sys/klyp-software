/**
 * GET /claim?offer=17&until=2026-11-09 (or offer=14 for Black Friday) — the email's "Claim" button, straight to the payment page.
 *
 *  - Offer ended or not valid: the normal upgrade page.
 *  - Signed out: sign in first, then come straight back here.
 *  - Signed in and eligible: Stripe's payment page showing the $17 first month.
 *  - Signed in but not eligible for $17 (already Pro, or has paid before): the normal upgrade page, so nobody lands on a
 *    Stripe page that does not match the email.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OFFER_COOKIE, OFFER_COOKIE_MAX_AGE, OFFER_PARAM, OFFER_UNTIL_PARAM, isOfferValue, offerCookieActive, offerCookieValueFor } from "@/lib/offer-cookie";
import { POST as startCheckout } from "@/app/api/stripe/checkout/route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { origin, searchParams, search } = req.nextUrl;
  const fresh = isOfferValue(searchParams.get(OFFER_PARAM)) ? offerCookieValueFor(searchParams.get(OFFER_UNTIL_PARAM), Date.now(), searchParams.get(OFFER_PARAM)!) : null;
  const saved = req.cookies.get(OFFER_COOKIE)?.value;
  const offer = fresh ?? (offerCookieActive(saved) ? saved! : null);
  const go = (path: string) => NextResponse.redirect(`${origin}${path}`, 303);
  const remember = (res: NextResponse) => {
    if (fresh !== null) {
      res.cookies.set(OFFER_COOKIE, fresh, { maxAge: OFFER_COOKIE_MAX_AGE, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
    }
    return res;
  };

  if (offer === null) return go("/dashboard/upgrade");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return remember(go(`/login?next=${encodeURIComponent(`/claim${search}`)}`));

  const res = await startCheckout(new NextRequest(`${origin}/api/stripe/checkout`, {
    method: "POST",
    headers: { cookie: `${OFFER_COOKIE}=${offer}`, "content-type": "application/json" },
    body: JSON.stringify({ interval: "month" }),
  }));
  const data = (await res.json().catch(() => ({}))) as { url?: string; first_month?: boolean };
  if (res.ok && data.url && data.first_month === true) return remember(NextResponse.redirect(data.url, 303));
  return remember(go("/dashboard/upgrade"));
}
