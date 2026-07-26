/**
 * Private-beta access gate. ACCESS_KEYWORD is a single shared secret
 * (server-only env var) — no per-user codes, no database table.
 *
 * The gate cookie never stores the keyword itself: it stores an HMAC of a
 * fixed message keyed by ACCESS_KEYWORD, computed with Web Crypto so it
 * works identically in the Node (API route) and Edge (middleware) runtimes.
 */
export const ACCESS_GATE_COOKIE = "klyp_gate";

const GATE_MESSAGE = "klyp-access-granted";

async function hmac(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(GATE_MESSAGE));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Token to set as the gate cookie's value once the keyword has been verified. */
export function gateToken(): Promise<string> {
  const keyword = process.env.ACCESS_KEYWORD;
  if (!keyword) throw new Error("ACCESS_KEYWORD is not set.");
  return hmac(keyword);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether a gate cookie value proves the visitor already supplied the current keyword. */
export async function isValidGateCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue || !process.env.ACCESS_KEYWORD) return false;
  const expected = await gateToken();
  return timingSafeEqual(cookieValue, expected);
}
