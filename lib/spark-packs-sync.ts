/**
 * Repair for a Spark pack whose webhook was delayed or missed: look at the person's recent paid pack
 * checkouts in Stripe and add any that were never credited. The same reference (the checkout session id)
 * is used by the webhook and by this, and add_pack_sparks refuses a second grant for it, so the two can
 * never both credit one purchase, whichever gets there first.
 */
import { isPackSession, packForSession } from "./spark-packs.ts";

type DbError = { code?: string; message: string } | null;
export type PackSyncAdmin = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: DbError }> };
type Session = {
  id: string; mode?: string | null; payment_status?: string | null; status?: string | null; client_reference_id?: string | null;
  amount_total?: number | null; currency?: string | null; metadata?: Record<string, string> | null;
};
export type PackSyncStripe = { checkout: { sessions: { list(params: Record<string, unknown>): Promise<{ data: Session[] }> } } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function syncSparkPacks(opts: { stripe: PackSyncStripe; admin: PackSyncAdmin; userId: string; now?: number }): Promise<{ credited: number; alreadyCredited: number }> {
  if (!UUID.test(opts.userId)) throw new Error("syncSparkPacks: invalid user id");
  const since = Math.floor(((opts.now ?? Date.now()) - 3 * 86_400_000) / 1000);
  const { data } = await opts.stripe.checkout.sessions.list({ limit: 100, created: { gte: since } });
  let credited = 0;
  let alreadyCredited = 0;
  for (const session of data) {
    if (!isPackSession(session) || session.payment_status !== "paid" || session.status !== "complete") continue;
    // Only this person's own purchases.
    if (session.metadata?.user_id !== opts.userId || session.client_reference_id !== opts.userId) continue;
    const pack = packForSession(session);
    if (!pack) continue;
    const { error } = await opts.admin.rpc("add_pack_sparks", { p_user_id: opts.userId, p_sparks: pack.sparks, p_reference: session.id });
    if (error?.code === "23505") { alreadyCredited++; continue; }
    if (error) throw new Error(`Spark pack credit failed: ${error.message}`);
    credited++;
  }
  return { credited, alreadyCredited };
}
