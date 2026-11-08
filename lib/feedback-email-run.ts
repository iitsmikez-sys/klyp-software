/**
 * One pass of the job that emails each new "Something wrong?" message to the owner. It touches no database or email
 * service itself (everything is passed in), so "each message once, never lost on a failed send" can be tested with
 * plain fakes. The real wiring is in lib/feedback-email-worker.ts.
 */
import { buildFeedbackEmail, type FeedbackContext, type FeedbackRow } from "./feedback-email.ts";

export type FeedbackMail = { to: string; subject: string; html: string; text: string; replyTo: string | null };

export type FeedbackDeps = {
  now: () => number;
  log: (message: string) => void;
  /** Messages not emailed yet, oldest first. */
  listUnsent: () => Promise<FeedbackRow[]>;
  loadContext: (userId: string) => Promise<FeedbackContext>;
  /** Marks the message as emailed. False means another run got there first. */
  claim: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
  send: (mail: FeedbackMail) => Promise<void>;
};

export type FeedbackSummary = { sent: number; skipped: number; failed: number };

export async function runFeedbackEmails(deps: FeedbackDeps, options: { to: string }): Promise<FeedbackSummary> {
  const summary: FeedbackSummary = { sent: 0, skipped: 0, failed: 0 };
  for (const row of await deps.listUnsent()) {
    if (!(await deps.claim(row.id))) { summary.skipped++; continue; }
    try {
      // Context is best effort: a lookup that fails must not stop the message reaching the owner.
      const context = await deps.loadContext(row.user_id).catch((): FeedbackContext => ({ email: null, plan: "free", sparks: null, lastVideo: null }));
      const email = buildFeedbackEmail(row, context, deps.now());
      await deps.send({ to: options.to, subject: email.subject, html: email.html, text: email.text, replyTo: email.replyTo });
      summary.sent++;
      deps.log(`emailed feedback message ${row.id}`);
    } catch (err) {
      summary.failed++;
      deps.log(`could not email feedback message ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      await deps.release(row.id).catch(() => {});
    }
  }
  return summary;
}
