import { tokenClient } from "@/lib/profile-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeCreatorFeedback, type CreatorFeedbackRow } from "@/lib/creator-feedback";

export async function preferencesForToken(token: string): Promise<string> {
  const { data, error } = await tokenClient(token).from("clip_feedback")
    .select("clip_type,verdict,edited_at,downloaded_at").order("updated_at", { ascending: false }).limit(200);
  if (error) { console.warn("[feedback] preferences unavailable", error.message); return ""; }
  return summarizeCreatorFeedback((data ?? []) as CreatorFeedbackRow[]);
}

export async function preferencesForUser(userId: string): Promise<string> {
  const { data, error } = await createAdminClient().from("clip_feedback")
    .select("clip_type,verdict,edited_at,downloaded_at").eq("user_id", userId)
    .order("updated_at", { ascending: false }).limit(200);
  if (error) { console.warn("[feedback] preferences unavailable", error.message); return ""; }
  return summarizeCreatorFeedback((data ?? []) as CreatorFeedbackRow[]);
}
