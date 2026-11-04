/**
 * GET /auth/confirm?token_hash=...&type=recovery — the link in the reset-password email.
 *
 * Unlike the sign-in code link (/auth/callback), this works in ANY browser or device, so someone can ask for the
 * reset on their computer and open the email on their phone. The Supabase email template points here
 * (see docs/supabase-reset-email.md). A good link signs them in and opens the new-password page.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TYPES = new Set(["recovery", "signup", "email"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") ?? "";

  if (tokenHash && TYPES.has(type)) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      }
    );
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" | "signup" | "email" });
    if (!error) return NextResponse.redirect(`${origin}${type === "recovery" ? "/reset-password" : "/dashboard"}`);
  }

  // A used or expired link: the new-password page explains it and offers a fresh one.
  return NextResponse.redirect(`${origin}${type === "recovery" ? "/reset-password" : "/login?error=auth_callback_failed"}`);
}
