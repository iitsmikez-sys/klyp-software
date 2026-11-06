/** The one-question screen new users see: whose videos will they clip? The answer is kept on their account. */

export const AUDIENCE_KEY = "clip_for";

export const AUDIENCE_OPTIONS = [
  { value: "own", title: "My own streams", hint: "I stream and want clips of me" },
  { value: "others", title: "Other streamers", hint: "I run a clip page" },
  { value: "both", title: "Both", hint: "My streams and other people's" },
] as const;

export type AudienceAnswer = (typeof AUDIENCE_OPTIONS)[number]["value"];
/** "skipped" means they closed the question, so we never ask again. */
export type StoredAudience = AudienceAnswer | "skipped";

/** Only accounts this young are asked, so older users are never interrupted. */
export const ASK_WITHIN_DAYS = 7;

export function isStoredAudience(value: unknown): value is StoredAudience {
  return value === "skipped" || AUDIENCE_OPTIONS.some((o) => o.value === value);
}

type UserLike = { created_at?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

export type AudienceTally = { own: number; others: number; both: number; skipped: number; unanswered: number };

/** Adds up the answers across accounts, for the owner-only Sources page. */
export function tallyAudience(users: Iterable<{ user_metadata?: Record<string, unknown> | null }>): AudienceTally {
  const tally: AudienceTally = { own: 0, others: 0, both: 0, skipped: 0, unanswered: 0 };
  for (const u of users) {
    const v = u.user_metadata?.[AUDIENCE_KEY];
    if (isStoredAudience(v)) tally[v]++;
    else tally.unanswered++;
  }
  return tally;
}

/** Ask a signed-in, recent account that has neither answered nor skipped. */
export function shouldAskAudience(user: UserLike, now = Date.now()): boolean {
  if (!user?.created_at) return false;
  if (isStoredAudience(user.user_metadata?.[AUDIENCE_KEY])) return false;
  const age = now - Date.parse(user.created_at);
  return Number.isFinite(age) && age >= 0 && age <= ASK_WITHIN_DAYS * 86_400_000;
}
