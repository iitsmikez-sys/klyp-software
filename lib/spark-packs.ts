/**
 * Spark packs: one-time purchases of extra Sparks, for any plan. Bought Sparks never expire, are spent
 * after the monthly ones, and survive resets (migration 042). They cost more per Spark than the Pro
 * plan on purpose, so Pro stays the best value and packs are for top-ups.
 */
export type SparkPack = { id: "p100" | "p250" | "p500"; sparks: number; cents: number };

export const SPARK_PACKS: readonly SparkPack[] = [
  { id: "p100", sparks: 100, cents: 800 },
  { id: "p250", sparks: 250, cents: 1800 },
  { id: "p500", sparks: 500, cents: 3300 },
];
export const DEFAULT_PACK_ID: SparkPack["id"] = "p250";

export const packById = (id: unknown): SparkPack | undefined => SPARK_PACKS.find((p) => p.id === id);

/**
 * The pack a paid Checkout Session was for. Both the pack id in its metadata and the amount actually
 * charged must agree, so a tampered or mismatched session can never grant more than was paid for.
 */
export function packForSession(session: { amount_total?: number | null; currency?: string | null; metadata?: Record<string, string> | null }): SparkPack | undefined {
  const pack = packById(session.metadata?.pack);
  if (!pack) return undefined;
  return session.amount_total === pack.cents && (session.currency ?? "usd") === "usd" ? pack : undefined;
}

export const isPackSession = (session: { mode?: string | null; metadata?: Record<string, string> | null }): boolean =>
  session.mode === "payment" && session.metadata?.kind === "spark_pack";

/**
 * How much cheaper a pack is per Spark than the smallest pack, as a whole percent rounded down (0 for the
 * smallest), so a discount is never overstated. Shown as "Save 10%", never as cents. Integer math keeps it exact.
 */
export function packSavingsPercent(pack: SparkPack): number {
  const smallest = SPARK_PACKS[0];
  const paidPercent = (pack.cents * smallest.sparks * 100) / (pack.sparks * smallest.cents);
  return Math.max(0, Math.floor(100 - paidPercent));
}

/** The smallest pack that covers a shortfall of Sparks, or the biggest pack when none does. */
export function packToCover(shortfall: number): SparkPack {
  return SPARK_PACKS.find((p) => p.sparks >= shortfall) ?? SPARK_PACKS[SPARK_PACKS.length - 1];
}
