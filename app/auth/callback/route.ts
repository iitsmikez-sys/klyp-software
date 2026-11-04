import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const cookieStore = await cookies();
    // The login page saves "come back to /claim" in a cookie (only /claim paths are accepted).
    const savedRaw = cookieStore.get?.("klyp_next")?.value;
    let saved: string | null = null;
    try { saved = savedRaw ? decodeURIComponent(savedRaw) : null; } catch { saved = null; }
    const savedNext = saved && /^\/claim(\?[A-Za-z0-9=&._%-]{0,200})?$/.test(saved) ? saved : null;
    const next = searchParams.get("next") ?? savedNext ?? "/dashboard";
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      if (savedNext) response.cookies?.set?.("klyp_next", "", { path: "/", maxAge: 0 });
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
