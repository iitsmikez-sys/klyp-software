/**
 * One pass of the activation-email job. It touches no database or email service itself: everything it needs is
 * passed in, so the rules (who, when, never twice) can be tested with plain fakes. The real wiring is in
 * lib/activation-email-worker.ts.
 */
import { dueKind, isEmailable, type ActivationKind, type ActivationProfile } from "./activation-email-rules.ts";
import { buildActivationEmail } from "./activation-email-content.ts";
import { unsubscribeUrl } from "./activation-unsubscribe.ts";

export type Candidate = ActivationProfile & { id: string };
export type MailAddress = { email: string | null; confirmed: boolean };
export type OutgoingMail = { to: string; subject: string; html: string; text: string; unsubscribeUrl: string };

export type ActivationDeps = {
  now: () => number;
  /** Accounts that might be due for this email (the job still re-checks every rule). */
  listCandidates: (kind: ActivationKind) => Promise<Candidate[]>;
  /** Which of these accounts have run at least one video. */
  ranVideo: (ids: string[]) => Promise<Set<string>>;
  getAddress: (id: string) => Promise<MailAddress | null>;
  /** Marks the email as sent for this account. False means another run got there first. */
  claim: (id: string, kind: ActivationKind) => Promise<boolean>;
  /** Takes the mark back off after a failed send, so the next pass tries again. */
  release: (id: string, kind: ActivationKind) => Promise<void>;
  send: (mail: OutgoingMail) => Promise<void>;
  log: (message: string) => void;
};

export type ActivationOptions = { mode: "on" | "dry"; siteUrl: string; secret: string };
export type ActivationSummary = { sent: number; wouldSend: number; skipped: number; failed: number };

const campaignTag = (kind: ActivationKind) => (kind === "first" ? "email_new1" : "email_new2");

export async function runActivationEmails(deps: ActivationDeps, options: ActivationOptions): Promise<ActivationSummary> {
  const summary: ActivationSummary = { sent: 0, wouldSend: 0, skipped: 0, failed: 0 };
  const site = options.siteUrl.replace(/\/+$/, "");

  for (const kind of ["first", "second"] as const) {
    const candidates = await deps.listCandidates(kind);
    if (candidates.length === 0) continue;
    const ran = await deps.ranVideo(candidates.map((c) => c.id));
    const now = deps.now();

    for (const candidate of candidates) {
      if (dueKind({ profile: candidate, ranVideo: ran.has(candidate.id), now }) !== kind) { summary.skipped++; continue; }
      const address = await deps.getAddress(candidate.id);
      if (!address || !address.confirmed || !isEmailable(address.email)) { summary.skipped++; continue; }

      const content = buildActivationEmail(kind, {
        dashboardUrl: `${site}/dashboard?src=${campaignTag(kind)}`,
        unsubscribeUrl: unsubscribeUrl(site, candidate.id, options.secret),
      });
      const mail: OutgoingMail = { to: address.email, subject: content.subject, html: content.html, text: content.text, unsubscribeUrl: unsubscribeUrl(site, candidate.id, options.secret) };

      if (options.mode === "dry") {
        summary.wouldSend++;
        deps.log(`dry run: would send the ${kind} email to account ${candidate.id}`);
        continue;
      }
      if (!(await deps.claim(candidate.id, kind))) { summary.skipped++; continue; }
      try {
        await deps.send(mail);
        summary.sent++;
        deps.log(`sent the ${kind} email to account ${candidate.id}`);
      } catch (err) {
        summary.failed++;
        deps.log(`could not send the ${kind} email to account ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`);
        await deps.release(candidate.id, kind).catch(() => {});
      }
    }
  }
  return summary;
}
