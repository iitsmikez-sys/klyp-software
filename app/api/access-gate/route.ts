/**
 * POST /api/access-gate — verify the shared private-beta keyword.
 *
 * ACCESS_KEYWORD lives server-side only (env var). On a correct guess we set
 * an httpOnly cookie carrying an HMAC of the keyword (see lib/access-gate.ts)
 * — never the keyword itself — so middleware can recheck it on later
 * requests without a database.
 */
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_GATE_COOKIE, gateToken } from "@/lib/access-gate";

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  const keyword = process.env.ACCESS_KEYWORD;
  if (!keyword) {
    return NextResponse.json({ error: "Access gate is not configured." }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (tooManyAttempts(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const guess = typeof body?.keyword === "string" ? body.keyword.trim() : "";

  if (!guess || guess !== keyword.trim()) {
    return NextResponse.json({ error: "Incorrect keyword." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_GATE_COOKIE, await gateToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180, // 180 days
  });
  return res;
}
