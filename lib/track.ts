"use client";

/**
 * Records one thing a signed-in person did (a download, a visit to the upgrade page, a click on "Get Pro") in the
 * usage_events table (migration 048). It is best effort and silent: if the person is signed out, the table does not
 * exist yet, or anything else goes wrong, nothing happens and nothing is shown, so it can never get in the way.
 */
import { createClient } from "@/lib/supabase/client";

export type EventProps = Record<string, string | number | boolean | null>;

export async function trackEvent(name: string, props: EventProps = {}): Promise<void> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from("usage_events").insert({ user_id: userId, name, props });
  } catch {
    /* tracking must never get in the way */
  }
}
