/** Adds up signups, people who ran a VOD, and paying customers for each source. Used by the owner-only Sources page. */
export const BEFORE_TRACKING = "Before tracking";

export type SourceProfile = { id: string; acquisition_source: string | null; stripe_subscription_id: string | null };
export type SourceRow = { source: string; signups: number; ranVod: number; paid: number };

export function buildSourceReport(profiles: SourceProfile[], usersWhoRanVod: Iterable<string>): SourceRow[] {
  const ran = new Set(usersWhoRanVod);
  const rows = new Map<string, SourceRow>();
  for (const p of profiles) {
    const source = p.acquisition_source || BEFORE_TRACKING;
    const row = rows.get(source) ?? { source, signups: 0, ranVod: 0, paid: 0 };
    row.signups++;
    if (ran.has(p.id)) row.ranVod++;
    if (p.stripe_subscription_id) row.paid++;
    rows.set(source, row);
  }
  return [...rows.values()].sort((a, b) => {
    // "Before tracking" goes last; everything else by signups, then name.
    if (a.source === BEFORE_TRACKING) return 1;
    if (b.source === BEFORE_TRACKING) return -1;
    return b.signups - a.signups || a.source.localeCompare(b.source);
  });
}

/** Comma-separated list of owner emails, lowercased. Empty means nobody can open the page. */
export function adminEmails(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export const isAdminEmail = (email: string | null | undefined, raw: string | undefined) =>
  !!email && adminEmails(raw).includes(email.toLowerCase());
