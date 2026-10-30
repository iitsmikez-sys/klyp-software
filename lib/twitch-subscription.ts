import type { SupabaseClient } from '@supabase/supabase-js';

/** Persist the Twitch webhook ID after checking the Klyp stream owner. */
export async function saveEventSubSubscription(
  admin: SupabaseClient,
  streamId: string,
  userId: string,
  subscriptionId: string
): Promise<void> {
  const { data, error } = await admin.from('streams')
    .update({ eventsub_subscription_id: subscriptionId })
    .eq('id', streamId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Could not save Twitch EventSub subscription: ${error.message}`);
  if (!data) throw new Error('Could not save Twitch EventSub subscription: stream not found');
}
