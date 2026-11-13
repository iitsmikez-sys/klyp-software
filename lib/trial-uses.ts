/**
 * Which trials have been used. Each used trial leaves keys behind (the account's real email, the card), in the trial_uses table
 * (supabase/migrations/051_trial_uses.sql), so a second account with the same email or the same card does not get a second one.
 * Server only: the table has no policies, so only the service role can read or write it.
 */
import { createAdminClient } from "@/lib/supabase/admin";

/** Has any of these keys already been used by a DIFFERENT account? */
export async function trialKeysUsedByOthers(userId: string, keys: string[]): Promise<boolean> {
  if (keys.length === 0) return false;
  const { data, error } = await createAdminClient().from("trial_uses").select("key,user_id").in("key", keys);
  if (error) throw new Error(`Could not check earlier trials: ${error.message}`);
  return (data ?? []).some((row: { user_id: string }) => row.user_id !== userId);
}

/**
 * Record a trial as used. Returns "used" when another account already holds one of the keys (this trial must not go ahead), "ok"
 * otherwise. Keys this account already holds are left alone, so a retry of the same webhook is harmless.
 */
export async function claimTrialKeys(userId: string, keys: string[]): Promise<"ok" | "used"> {
  if (await trialKeysUsedByOthers(userId, keys)) return "used";
  const admin = createAdminClient();
  for (const key of keys) {
    const { error } = await admin.from("trial_uses").insert({ key, user_id: userId });
    // 23505: the key exists. Another account may have claimed it a moment ago, so look again.
    if (error && error.code !== "23505") throw new Error(`Could not record the trial: ${error.message}`);
  }
  return (await trialKeysUsedByOthers(userId, keys)) ? "used" : "ok";
}
