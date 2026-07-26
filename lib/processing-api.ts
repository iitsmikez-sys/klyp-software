"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Base URL for the processing service (analyze/clip/preview/upload/duration).
 * Empty in local dev — same origin, relative fetch, unchanged behavior — and
 * set to the Railway deployment's URL on the Vercel frontend in production.
 */
const PROCESSING_BASE = process.env.NEXT_PUBLIC_PROCESSING_API_URL || "";

/** Current user's Supabase access token, or null if signed out. */
async function currentAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * fetch() wrapper for the processing service — prefixes the base URL and
 * attaches the user's Supabase access token as a Bearer header. The
 * processing service validates it server-side (lib/profile-token.ts) instead
 * of reading cookies, since cookies don't cross origins in production.
 */
export async function processingFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await currentAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${PROCESSING_BASE}${path}`, { ...init, headers });
}

/** Resolve a processing-service URL for callers that can't use fetch() directly (e.g. XMLHttpRequest uploads). */
export function processingUrl(path: string): string {
  return `${PROCESSING_BASE}${path}`;
}

/** Same token lookup, exposed for callers (like XHR) that need to set the header themselves. */
export { currentAccessToken as processingAuthToken };
