/**
 * Saves a new account's source on its profile. It only ever fills an empty value, and only for accounts
 * created in the last two days, so people who joined before tracking stay "unknown (before tracking)"
 * instead of being credited to whatever page they happened to visit later.
 */
import { cleanSource, UNKNOWN_SOURCE } from "./acquisition-source.ts";

export const NEW_ACCOUNT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type ProfileRow = { acquisition_source: string | null; created_at: string };
type Db = {
  from(table: "profiles"): {
    select(columns: string): { eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: ProfileRow | null; error: { message: string } | null }> } };
    update(values: { acquisition_source: string }): { eq(column: "id", value: string): { is(column: "acquisition_source", value: null): PromiseLike<{ error: { message: string } | null }> } };
  };
};

export type ClaimResult = "saved" | "already-set" | "too-old" | "no-profile";

export async function claimAcquisitionSource(db: Db, userId: string, cookieValue: string | null | undefined, now = Date.now()): Promise<ClaimResult> {
  const { data, error } = await db.from("profiles").select("acquisition_source,created_at").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);
  if (!data) return "no-profile";
  if (data.acquisition_source) return "already-set";
  if (now - new Date(data.created_at).getTime() > NEW_ACCOUNT_WINDOW_MS) return "too-old";
  const source = cleanSource(cookieValue) ?? UNKNOWN_SOURCE;
  const { error: updateError } = await db.from("profiles").update({ acquisition_source: source }).eq("id", userId).is("acquisition_source", null);
  if (updateError) throw new Error(`Could not save source: ${updateError.message}`);
  return "saved";
}
