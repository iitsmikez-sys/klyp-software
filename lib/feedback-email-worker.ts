/**
 * Background worker that emails every new "Something wrong?" message to the owner, with the person's plan, Sparks, last
 * video and browser attached, and Reply-To set to the person so a reply in Gmail goes to them. Processing service only
 * (started from instrumentation.ts). It checks every minute.
 *
 * It needs RESEND_API_KEY and an address to send to: FEEDBACK_TO, or else ACTIVATION_REPLY_TO (already set for the
 * activation emails). FEEDBACK_EMAILS=off turns it off. It sends only to the owner, never to customers.
 * Needs migration 049; until it is applied the job logs a note and does nothing.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeedbackEmails, type FeedbackDeps } from "@/lib/feedback-email-run";
import type { FeedbackContext, FeedbackRow } from "@/lib/feedback-email";

const EVERY_MS = 60_000;
const FIRST_RUN_DELAY_MS = 30_000;
const log = (message: string) => console.log(`[feedback-emails] ${message}`);

function realDeps(): FeedbackDeps {
  const db = createAdminClient();
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ACTIVATION_FROM || "Klyp <hello@send.klyp.world>";
  return {
    now: () => Date.now(),
    log,
    async listUnsent() {
      const { data, error } = await db.from("feedback_messages").select("id,user_id,reason,message,page,user_agent,created_at")
        .is("emailed_at", null).order("created_at", { ascending: true }).limit(20);
      if (error) throw new Error(`could not read messages: ${error.message}`);
      return (data ?? []) as FeedbackRow[];
    },
    async loadContext(userId): Promise<FeedbackContext> {
      const [{ data: auth }, { data: profile }, { data: jobs }] = await Promise.all([
        db.auth.admin.getUserById(userId),
        db.from("profiles").select("tier,stripe_subscription_id,sparks").eq("id", userId).maybeSingle(),
        db.from("analysis_jobs").select("source_key,status,error,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
      ]);
      const job = (jobs ?? [])[0] as { source_key: string; status: string; error: string | null; created_at: string } | undefined;
      const p = profile as { tier?: string | null; stripe_subscription_id?: string | null; sparks?: number | null } | null;
      return {
        email: auth?.user?.email ?? null,
        plan: p?.tier === "pro" || p?.stripe_subscription_id ? "pro" : "free",
        sparks: typeof p?.sparks === "number" ? p.sparks : null,
        lastVideo: job ? { platform: job.source_key.split(":")[0] || "unknown", status: job.status, error: job.error, at: job.created_at } : null,
      };
    },
    async claim(id) {
      const { data, error } = await db.from("feedback_messages").update({ emailed_at: new Date().toISOString() }).eq("id", id).is("emailed_at", null).select("id");
      if (error) throw new Error(`could not mark the message as emailed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async release(id) {
      await db.from("feedback_messages").update({ emailed_at: null }).eq("id", id);
    },
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`the email service answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

let started = false;

export function startFeedbackEmailWorker(): void {
  if (started) return;
  if ((process.env.FEEDBACK_EMAILS ?? "").trim().toLowerCase() === "off") return;
  const to = (process.env.FEEDBACK_TO || process.env.ACTIVATION_REPLY_TO || "").trim();
  if (!process.env.RESEND_API_KEY) { log("RESEND_API_KEY is not set, so feedback messages are saved but not emailed."); return; }
  if (!to) { log("Neither FEEDBACK_TO nor ACTIVATION_REPLY_TO is set, so feedback messages are saved but not emailed."); return; }
  started = true;
  log("started");

  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runFeedbackEmails(realDeps(), { to });
      if (summary.sent || summary.failed) log(`pass done: ${JSON.stringify(summary)}`);
    } catch (err) {
      log(`pass failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => { void pass(); }, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(() => { void pass(); }, EVERY_MS).unref?.();
}
