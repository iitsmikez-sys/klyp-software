/**
 * Twitch Helix API client for Auto-Clipping — channel connect (OAuth identify),
 * EventSub subscription management, and VOD lookup.
 *
 * Two different token types are in play:
 *   - App access token (Client Credentials grant) — used for Get Videos and
 *     for creating/deleting EventSub subscriptions. Cached in-memory here and
 *     refreshed on expiry. Module-level cache is best-effort on Vercel (may
 *     miss on a cold start) and fully effective on Railway's long-lived process.
 *   - User access token (Authorization Code grant) — used ONLY once, right
 *     after a user connects their channel, to identify who they are via
 *     Get Users. Never stored — see app/api/twitch/callback/route.ts.
 *
 * Get Users/Get Videos need no OAuth scope beyond a valid token (confirmed
 * against Twitch's docs — user:read:email is the only related scope, and it's
 * optional, only needed for email access which Klyp doesn't need).
 */
import { createHmac, timingSafeEqual } from "crypto";

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/* ── App access token (Client Credentials grant) ── */

let cachedAppToken: { token: string; expiresAt: number } | null = null;

export async function getAppAccessToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) {
    return cachedAppToken.token;
  }
  const clientId = requireEnv(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID");
  const clientSecret = requireEnv(TWITCH_CLIENT_SECRET, "TWITCH_CLIENT_SECRET");

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to get Twitch app access token: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAppToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/** Shared Helix request helper — attaches Client-Id + app bearer token. */
async function helix(path: string, init: RequestInit = {}): Promise<Response> {
  const clientId = requireEnv(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID");
  const token = await getAppAccessToken();
  return fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
  });
}

/* ── User identify (Authorization Code grant — connect flow only) ── */

export function twitchAuthorizeUrl(redirectUri: string, state: string): string {
  const clientId = requireEnv(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "", // identify only — no elevated scope needed for Get Users id/login
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

/** Exchanges an OAuth code for a short-lived user access token (used once, then discarded). */
export async function exchangeTwitchCode(code: string, redirectUri: string): Promise<string> {
  const clientId = requireEnv(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID");
  const clientSecret = requireEnv(TWITCH_CLIENT_SECRET, "TWITCH_CLIENT_SECRET");
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Twitch code exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export type TwitchUser = { id: string; login: string; display_name: string };

/** Identifies the user behind a (one-time-use) user access token. No scope required. */
export async function getTwitchUser(userAccessToken: string): Promise<TwitchUser> {
  const clientId = requireEnv(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID");
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${userAccessToken}` },
  });
  if (!res.ok) throw new Error(`Twitch Get Users failed: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: TwitchUser[] };
  const user = data.data[0];
  if (!user) throw new Error("Twitch returned no user for this token.");
  return user;
}

/* ── Get Videos — one broadcaster_id per call (Twitch doesn't batch this,
 * unlike Get Streams — confirmed against the API reference). ── */

export type TwitchVideo = {
  id: string;
  title: string;
  url: string;
  duration: string; // e.g. "3h21m10s", "45m10s", "10s"
  created_at: string;
};

/** Parses Twitch's "3h21m10s" duration format into seconds. */
export function parseTwitchDuration(duration: string): number {
  const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

/** Most recent published VOD ("archive") for a broadcaster, or null if none. */
export async function getLatestVod(broadcasterId: string): Promise<TwitchVideo | null> {
  const res = await helix(`/videos?user_id=${broadcasterId}&type=archive&first=1`);
  if (!res.ok) throw new Error(`Twitch Get Videos failed: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: TwitchVideo[] };
  return data.data[0] ?? null;
}

/* ── EventSub subscription management (app access token) ── */

export async function createStreamOfflineSubscription(
  broadcasterId: string,
  callbackUrl: string
): Promise<string> {
  const secret = requireEnv(TWITCH_EVENTSUB_SECRET, "TWITCH_EVENTSUB_SECRET");
  const res = await helix("/eventsub/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "stream.offline",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: "webhook", callback: callbackUrl, secret },
    }),
  });
  if (!res.ok) {
    throw new Error(`Twitch EventSub subscribe failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data: { id: string }[] };
  return data.data[0].id;
}

/** Best-effort — a subscription that's already gone (e.g. Twitch revoked it) isn't an error here. */
export async function deleteEventSubSubscription(subscriptionId: string): Promise<void> {
  const res = await helix(`/eventsub/subscriptions?id=${subscriptionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Twitch EventSub unsubscribe failed: HTTP ${res.status} ${await res.text()}`);
  }
}

/**
 * Verifies an incoming EventSub webhook's HMAC-SHA256 signature.
 * message = message-id + message-timestamp + raw request body (per Twitch's spec).
 */
export function verifyEventSubSignature(
  messageId: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return false;
  const secret = requireEnv(TWITCH_EVENTSUB_SECRET, "TWITCH_EVENTSUB_SECRET");
  const expected = "sha256=" + createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
