import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSourceReport, isAdminEmail, BEFORE_TRACKING, type SourceProfile } from "@/lib/source-report";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where signups come from — Klyp" };

const PAGE = 1000;
const MAX_ROWS = 20000;

/** Owner-only: where signups come from, how many ran a VOD, and how many paid. Anyone else gets a 404. */
export default async function SourcesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email, process.env.KLYP_ADMIN_EMAILS)) notFound();

  const admin = createAdminClient();
  const profiles: SourceProfile[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin.from("profiles").select("id,acquisition_source,stripe_subscription_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read profiles: ${error.message}`);
    profiles.push(...(data as SourceProfile[]));
    if (data.length < PAGE) break;
  }
  const ranVod = new Set<string>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin.from("analysis_jobs").select("user_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read analyses: ${error.message}`);
    for (const row of data) ranVod.add(row.user_id as string);
    if (data.length < PAGE) break;
  }

  const rows = buildSourceReport(profiles, ranVod);
  const total = profiles.length;
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <h1 className="font-syne text-2xl font-bold text-foreground mb-1">Where signups come from</h1>
      <p className="text-sm text-foreground-muted mb-6">
        Only you can see this page. &ldquo;{BEFORE_TRACKING}&rdquo; means the account was created before tracking started.
        Counts include any test accounts. Tag your links with <code className="text-accent">?src=tiktok</code>, <code className="text-accent">?src=twitch</code>,
        <code className="text-accent"> ?src=email1</code> and so on to see them here.
      </p>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1.6fr_0.8fr_1fr_0.7fr] gap-2 px-4 py-3 text-xs text-foreground-muted border-b border-border">
          <span>Source</span><span>Signups</span><span>Ran a VOD</span><span>Paid</span>
        </div>
        {rows.map((row) => (
          <div key={row.source} className="grid grid-cols-[1.6fr_0.8fr_1fr_0.7fr] gap-2 px-4 py-3 text-sm text-foreground border-b border-border last:border-b-0 items-center">
            <span className={row.source === BEFORE_TRACKING ? "text-foreground-muted" : ""}>{row.source}</span>
            <span>{row.signups}</span>
            <span><span className="text-accent">{row.ranVod}</span> <span className="text-foreground-muted">· {pct(row.ranVod, row.signups)}</span></span>
            <span>{row.paid}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="px-4 py-6 text-sm text-foreground-muted">No accounts yet.</div>}
      </div>
      <p className="text-xs text-foreground-muted mt-3">{total} accounts in total. &ldquo;Ran a VOD&rdquo; means at least one analysis; &ldquo;Paid&rdquo; means an active Stripe subscription on the account.</p>
    </div>
  );
}
