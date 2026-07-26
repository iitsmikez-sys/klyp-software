/**
 * CORS helper for the processing service's API routes (analyze/clip/preview/
 * upload/duration) — the Vercel frontend calls these cross-origin, so the
 * browser blocks the request without these headers. Not needed on the Vercel
 * deployment's own routes (Stripe checkout/portal/webhook) — those stay
 * same-origin with the dashboard that calls them.
 *
 * Auth for these routes is a Bearer token (lib/profile-token.ts), not cookies,
 * so credentials aren't involved here — no Access-Control-Allow-Credentials
 * needed, and ALLOWED_ORIGIN can be a plain origin string or "*".
 */
import { NextResponse } from "next/server";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-file-name",
  };
}

/** Attach CORS headers to any Response/NextResponse without disturbing its existing headers/body. */
export function withCors<T extends Response>(res: T): T {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

/** Preflight handler — export as `OPTIONS` from each processing route. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
