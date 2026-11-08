/**
 * One pass of the follow-up email job. It touches no database or email service itself: everything it needs is passed
 * in, so the rules (who, when, never twice, dry mode sends nothing) can be tested with plain fakes. The real wiring is
 * in lib/return-email-worker.ts.
 */
import { isEmailable } from "./activation-email-rules.ts";
import { unsubscribeUrl } from "./activation-unsubscribe.ts";
import { returnDue, type AnalysisRow, type ReturnProfile } from "./return-email-rules.ts";
import { buildReturnEmail } from "./return-email-content.ts";
import { RETURN_REASONS, reasonUrl } from "./return-feedback.ts";

export type ReturnCandidate = { id: string; profile: ReturnProfile; analyses: AnalysisRow[] };
export type BestClip = { count: number; title: string; score: number; seconds: number };
export type ReturnMail = { to: string; subject: string; html: string; text: string; unsubscribeUrl: string };

export type ReturnDeps = {
  now: () => number;
  log: (message: string) => void;
  /** Free accounts whose only finished video is a few days old, with all their analyses. */
  listCandidates: () => Promise<ReturnCandidate[]>;
  /** The clips of that one analysis, boiled down to the count and the best one. Null when there is nothing to show. */
  loadBestClip: (userId: string, analysisCreatedAt: string) => Promise<BestClip | null>;
  getAddress: (id: string) => Promise<{ email: string | null; confirmed: boolean } | null>;
  /** Marks the email as sent. False means another run got there first. */
  claim: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
  send: (mail: ReturnMail) => Promise<void>;
};

export type ReturnOptions = { mode: "on" | "dry"; siteUrl: string; secret: string };
export type ReturnSummary = { sent: number; wouldSend: number; skipped: number; failed: number };

export async function runReturnEmails(deps: ReturnDeps, options: ReturnOptions): Promise<ReturnSummary> {
  const summary: ReturnSummary = { sent: 0, wouldSend: 0, skipped: 0, failed: 0 };
  const site = options.siteUrl.replace(/\/+$/, "");
  const candidates = await deps.listCandidates();
  const now = deps.now();

  for (const candidate of candidates) {
    const due = returnDue({ profile: candidate.profile, analyses: candidate.analyses, now });
    if (!due) { summary.skipped++; continue; }
    const best = await deps.loadBestClip(candidate.id, due.createdAt);
    if (!best || best.count < 1) { summary.skipped++; continue; }
    const address = await deps.getAddress(candidate.id);
    if (!address || !address.confirmed || !isEmailable(address.email)) { summary.skipped++; continue; }

    const unsub = unsubscribeUrl(site, candidate.id, options.secret);
    const content = buildReturnEmail(
      { clipCount: best.count, bestTitle: best.title, bestScore: best.score, bestSeconds: best.seconds, daysLeft: due.daysLeft, sparksLeft: Math.max(0, Math.floor(candidate.profile.sparks ?? 0)) },
      {
        dashboardUrl: `${site}/dashboard?src=email_return`,
        unsubscribeUrl: unsub,
        reasonLinks: RETURN_REASONS.map((r) => ({ key: r.key, label: r.label, url: reasonUrl(site, candidate.id, r.key, options.secret) })),
      },
    );
    const mail: ReturnMail = { to: address.email, subject: content.subject, html: content.html, text: content.text, unsubscribeUrl: unsub };

    if (options.mode === "dry") {
      summary.wouldSend++;
      deps.log(`dry run: would send the return email to account ${candidate.id}`);
      continue;
    }
    if (!(await deps.claim(candidate.id))) { summary.skipped++; continue; }
    try {
      await deps.send(mail);
      summary.sent++;
      deps.log(`sent the return email to account ${candidate.id}`);
    } catch (err) {
      summary.failed++;
      deps.log(`could not send the return email to account ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`);
      await deps.release(candidate.id).catch(() => {});
    }
  }
  return summary;
}
