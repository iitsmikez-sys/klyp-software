/**
 * Background worker for the activation emails — processing service only (started from instrumentation.ts, next to
 * the Auto-Clipping worker). Every few minutes it finds new accounts that have not run a video and sends the first
 * email (about 10 minutes after signup) or the second (24 hours). The rules live in lib/activation-email-rules.ts.
 *
 * It is OFF unless ACTIVATION_EMAILS is set:
 *   ACTIVATION_EMAILS=dry  only logs who it would email, sends nothing and marks nothing
 *   ACTIVATION_EMAILS=on   really sends (needs RESEND_API_KEY and ACTIVATION_EMAIL_SECRET)
 * Needs migration 046 (the sent marks on profiles); until it is applied the job logs a note and does nothing.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { FIRST_AFTER_MS, FIRST_UNTIL_MS, SECOND_AFTER_MS, SECOND_UNTIL_MS, type ActivationKind } from "@/lib/activation-email-rules";
import { runActivationEmails, type ActivationDeps, type Candidate } from "@/lib/activation-email-run";

const EVERY_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;
const COLUMN: Record<ActivationKind, "activation_email_1_at" | "activation_email_2_at"> = { first: "activation_email_1_at", second: "activation_email_2_at" };
const SELECT = "id,created_at,activation_email_1_at,activation_email_2_at,activation_emails_off";

const log = (message: string) => console.log(`[activation-emails] ${message}`);

function realDeps(): ActivationDeps {
  const db = createAdminClient();
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ACTIVATION_FROM || "Klyp <hello@send.klyp.world>";
  const replyTo = process.env.ACTIVATION_REPLY_TO || undefined;
  return {
    now: () => Date.now(),
    log,
    async listCandidates(kind) {
      const now = Date.now();
      const [after, until] = kind === "first" ? [FIRST_AFTER_MS, FIRST_UNTIL_MS] : [SECOND_AFTER_MS, SECOND_UNTIL_MS];
      let query = db.from("profiles").select(SELECT).eq("activation_emails_off", false)
        .lte("created_at", new Date(now - after).toISOString()).gte("created_at", new Date(now - until).toISOString());
      query = kind === "first"
        ? query.is("activation_email_1_at", null)
        : query.not("activation_email_1_at", "is", null).is("activation_email_2_at", null);
      const { data, error } = await query.limit(200);
      if (error) throw new Error(`could not read accounts: ${error.message}`);
      return (data ?? []) as Candidate[];
    },
    async ranVideo(ids) {
      const { data, error } = await db.from("analysis_jobs").select("user_id").in("user_id", ids);
      if (error) throw new Error(`could not read analyses: ${error.message}`);
      return new Set((data ?? []).map((row: { user_id: string }) => row.user_id));
    },
    async getAddress(id) {
      const { data, error } = await db.auth.admin.getUserById(id);
      if (error || !data?.user) return null;
      return { email: data.user.email ?? null, confirmed: !!data.user.email_confirmed_at };
    },
    async claim(id, kind) {
      const { data, error } = await db.from("profiles").update({ [COLUMN[kind]]: new Date().toISOString() }).eq("id", id).is(COLUMN[kind], null).select("id");
      if (error) throw new Error(`could not mark the email as sent: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async release(id, kind) {
      await db.from("profiles").update({ [COLUMN[kind]]: null }).eq("id", id);
    },
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          headers: { "List-Unsubscribe": `<${mail.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`the email service answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

let started = false;

export function startActivationEmailWorker(): void {
  if (started) return;
  const mode = process.env.ACTIVATION_EMAILS;
  if (mode !== "on" && mode !== "dry") return;
  const secret = process.env.ACTIVATION_EMAIL_SECRET;
  if (!secret) { log("ACTIVATION_EMAIL_SECRET is not set, so the activation emails stay off."); return; }
  if (mode === "on" && !process.env.RESEND_API_KEY) { log("RESEND_API_KEY is not set, so the activation emails stay off."); return; }
  started = true;
  const siteUrl = process.env.SITE_URL || "https://www.klyp.world";
  log(`started in ${mode} mode`);

  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runActivationEmails(realDeps(), { mode, siteUrl, secret });
      if (summary.sent || summary.wouldSend || summary.failed) log(`pass done: ${JSON.stringify(summary)}`);
    } catch (err) {
      log(`pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => { void pass(); }, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(() => { void pass(); }, EVERY_MS).unref?.();
}
