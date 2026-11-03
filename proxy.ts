import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { OFFER_COOKIE, OFFER_COOKIE_MAX_AGE, OFFER_PARAM, OFFER_VALUE } from "./lib/offer-cookie";

/** Remember that this visitor came from the $17 ad link. */
function saveOffer(response: NextResponse) {
  response.cookies.set(OFFER_COOKIE, OFFER_VALUE, { maxAge: OFFER_COOKIE_MAX_AGE, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}

export async function proxy(request: NextRequest) {
  const fromAd = request.nextUrl.searchParams.get(OFFER_PARAM) === OFFER_VALUE;
  const path = request.nextUrl.pathname;
  // Public pages only need the offer saved; skip the sign-in check there.
  if (path !== "/login" && !path.startsWith("/dashboard")) {
    const response = NextResponse.next({ request });
    if (fromAd) saveOffer(response);
    return response;
  }
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired — required for Server Component data fetching
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (fromAd) saveOffer(supabaseResponse);
  return supabaseResponse;
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login"],
};
