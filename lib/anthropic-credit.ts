import type { SupabaseClient } from "@supabase/supabase-js";

/** Anthropic returns this as a 400, so treating it as a transient retry is costly. */
export function isAnthropicCreditBalanceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /credit balance is too low to access the Anthropic API/i.test(message);
}

/** The processing service uses one shared provider key for every stream. */
export async function pauseAutomaticClipping(admin: SupabaseClient): Promise<void> {
  const { error: streamError } = await admin.from("streams")
    .update({ auto_clip_enabled: false }).eq("auto_clip_enabled", true);
  if (streamError) throw streamError;

  const { error: jobError } = await admin.from("auto_vod_jobs")
    .update({ status: "canceled", lease_until: null })
    .in("status", ["pending", "retry", "processing"]);
  if (jobError) throw jobError;
}
export class AnthropicCreditGate {
  private blockedUntil = 0;

  blockOn(error: unknown, now = Date.now()): void {
    if (isAnthropicCreditBalanceError(error)) {
      this.blockedUntil = Math.max(this.blockedUntil, now + 15 * 60_000);
    }
  }

  assertAvailable(now = Date.now()): void {
    if (now < this.blockedUntil) {
      throw new Error("Your credit balance is too low to access the Anthropic API. Klyp is waiting before retrying.");
    }
  }
}
export const anthropicCreditGate = new AnthropicCreditGate();
