/**
 * The one-click answers in the follow-up email ("why didn't you keep the clips?"). Each link carries the account id,
 * the answer and a code only we can make, so nobody can fake answers for other accounts. Pure apart from the signing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isUserId } from "./activation-unsubscribe.ts";

export const RETURN_REASONS = [
  { key: "not_good", label: "The clips weren't good" },
  { key: "missed", label: "It missed my best moments" },
  { key: "cuts", label: "The cuts were off" },
  { key: "slow", label: "It was too slow" },
  { key: "looking", label: "Just looking around" },
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number]["key"];
export const isReturnReason = (value: string | null | undefined): value is ReturnReason =>
  RETURN_REASONS.some((reason) => reason.key === value);

export function signReason(userId: string, reason: ReturnReason, secret: string): string {
  return createHmac("sha256", secret).update(`return-feedback:${userId.toLowerCase()}:${reason}`).digest("hex").slice(0, 32);
}

export function verifyReason(userId: string | null | undefined, reason: string | null | undefined, token: string | null | undefined, secret: string | undefined): reason is ReturnReason {
  if (!secret || !isUserId(userId) || !isReturnReason(reason) || !token) return false;
  const expected = Buffer.from(signReason(userId, reason, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function reasonUrl(siteUrl: string, userId: string, reason: ReturnReason, secret: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/api/return-feedback?u=${encodeURIComponent(userId)}&r=${reason}&t=${signReason(userId, reason, secret)}`;
}
