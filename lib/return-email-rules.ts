/**
 * Who gets the follow-up email for people who tried Klyp once and did not come back. Pure rules (no database, no email
 * service) so they can be tested.
 *
 * Someone is due when ALL of these hold:
 *  - they are on the Free plan, have not unsubscribed, and have not had this email before
 *  - they have exactly one finished analysis, it finished 2 to 4 days ago, and they have not started another since
 *  - they still have enough Sparks to run another video (the email invites them to)
 * The 4 day limit keeps the "your clips are saved for N more days" line true: Free results are kept 5 days.
 */
import { resultsDaysLeft } from "./results-retention.ts";

const HOUR = 3_600_000;
export const RETURN_AFTER_MS = 48 * HOUR;
export const RETURN_UNTIL_MS = 96 * HOUR;
/** The cheapest video costs 20 Sparks (lib/sparks.ts MIN_ANALYZE_COST): below that they cannot run another one. */
export const MIN_SPARKS_TO_RUN_ANOTHER = 20;

export type AnalysisRow = { status: string; created_at: string; updated_at: string | null };
export type ReturnProfile = {
  tier?: string | null;
  stripe_subscription_id?: string | null;
  sparks: number | null;
  return_email_at: string | null;
  activation_emails_off: boolean;
};

export const isFreePlan = (profile: Pick<ReturnProfile, "tier" | "stripe_subscription_id">) =>
  profile.tier !== "pro" && !profile.stripe_subscription_id;

export type ReturnDue = { createdAt: string; completedAt: string; daysLeft: number };

export function returnDue(input: { profile: ReturnProfile; analyses: AnalysisRow[]; now: number }): ReturnDue | null {
  const { profile, analyses, now } = input;
  if (profile.return_email_at || profile.activation_emails_off || !isFreePlan(profile)) return null;
  if ((profile.sparks ?? 0) < MIN_SPARKS_TO_RUN_ANOTHER) return null;

  const completed = analyses.filter((a) => a.status === "completed");
  if (completed.length !== 1) return null;
  const done = completed[0];
  const createdMs = Date.parse(done.created_at);
  const completedAt = done.updated_at ?? done.created_at;
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(completedMs)) return null;
  // Any other attempt started after this one (finished, failed or still running) means they came back.
  if (analyses.some((a) => a !== done && Date.parse(a.created_at) >= createdMs)) return null;

  const age = now - completedMs;
  if (age < RETURN_AFTER_MS || age > RETURN_UNTIL_MS) return null;
  const daysLeft = resultsDaysLeft(completedAt, false, now);
  if (daysLeft < 1) return null;
  return { createdAt: done.created_at, completedAt, daysLeft };
}
