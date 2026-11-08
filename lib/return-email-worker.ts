/**
 * Background worker for the follow-up email to people who tried Klyp once and did not come back. Processing service
 * only (started from instrumentation.ts, next to the activation emails). Every half hour it finds free accounts whose
 * only finished video is 2 to 4 days old and sends one email with their best clip and one-click answers. The rules
 * live in lib/return-email-rules.ts.
 *
 * It is OFF unless RETURN_EMAILS is set:
 *   RETURN_EMAILS=dry  only logs who it would email, sends nothing and marks nothing
 *   RETURN_EMAILS=on   really sends (needs RESEND_API_KEY and ACTIVATION_EMAIL_SECRET, the same ones as the activation emails)
 * Needs migration 047; until it is applied the job logs a note and does nothing.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { RETURN_AFTER_MS, RETURN_UNTIL_MS, type AnalysisRow, type ReturnProfile } from "@/lib/return-email-rules";
import { runReturnEmails, type BestClip, type ReturnCandidate, type ReturnDeps } from "@/lib/return-email-run";

const EVERY_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 2 * 60_000;
const PROFILE_SELECT = "id,tier,stripe_subscription_id,sparks,return_email_at,activation_emails_off";

const log = (message: string) => console.log(`[return-emails] ${message}`);
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

function realDeps(): ReturnDeps {
  const db = createAdminClient();
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ACTIVATION_FROM || "Klyp <hello@send.klyp.world>";
  const replyTo = process.env.ACTIVATION_REPLY_TO || undefined;
  return {
    now: () => Date.now(),
    log,
    async listCandidates() {
      const now = Date.now();
      const { data: window, error } = await db.from("analysis_jobs").select("user_id").eq("status", "completed")
        .gte("updated_at", new Date(now - RETURN_UNTIL_MS).toISOString())
        .lte("updated_at", new Date(now - RETURN_AFTER_MS).toISOString()).limit(500);
      if (error) throw new Error(`could not read analyses: ${error.message}`);
      const ids = [...new Set((window ?? []).map((row: { user_id: string }) => row.user_id))];
      const candidates: ReturnCandidate[] = [];
      for (const part of chunks(ids, 100)) {
        const { data: profiles, error: profileError } = await db.from("profiles").select(PROFILE_SELECT).in("id", part)
          .is("return_email_at", null).eq("activation_emails_off", false);
        if (profileError) throw new Error(`could not read accounts: ${profileError.message}`);
        const eligible = (profiles ?? []) as (ReturnProfile & { id: string })[];
        if (eligible.length === 0) continue;
        const { data: rows, error: rowError } = await db.from("analysis_jobs").select("user_id,status,created_at,updated_at").in("user_id", eligible.map((p) => p.id));
        if (rowError) throw new Error(`could not read analyses: ${rowError.message}`);
        for (const profile of eligible) {
          candidates.push({
            id: profile.id,
            profile,
            analyses: (rows ?? []).filter((r: { user_id: string }) => r.user_id === profile.id) as AnalysisRow[],
          });
        }
      }
      return candidates;
    },
    async loadBestClip(userId, analysisCreatedAt): Promise<BestClip | null> {
      const { data, error } = await db.from("analysis_jobs").select("analysis_clips").eq("user_id", userId).eq("status", "completed").eq("created_at", analysisCreatedAt).limit(1);
      if (error) throw new Error(`could not read clips: ${error.message}`);
      const clips = (data?.[0]?.analysis_clips ?? []) as { title?: string; viral_score?: number; start_seconds?: number; end_seconds?: number }[];
      const scored = clips.filter((c) => typeof c.title === "string" && typeof c.viral_score === "number");
      if (scored.length === 0) return null;
      const best = scored.reduce((a, b) => ((b.viral_score as number) > (a.viral_score as number) ? b : a));
      return {
        count: clips.length,
        title: best.title as string,
        score: best.viral_score as number,
        seconds: Math.max(0, (best.end_seconds ?? 0) - (best.start_seconds ?? 0)),
      };
    },
    async getAddress(id) {
      const { data, error } = await db.auth.admin.getUserById(id);
      if (error || !data?.user) return null;
      return { email: data.user.email ?? null, confirmed: !!data.user.email_confirmed_at };
    },
    async claim(id) {
      const { data, error } = await db.from("profiles").update({ return_email_at: new Date().toISOString() }).eq("id", id).is("return_email_at", null).select("id");
      if (error) throw new Error(`could not mark the email as sent: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async release(id) {
      await db.from("profiles").update({ return_email_at: null }).eq("id", id);
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

export function startReturnEmailWorker(): void {
  if (started) return;
  const mode = process.env.RETURN_EMAILS;
  if (mode !== "on" && mode !== "dry") return;
  const secret = process.env.ACTIVATION_EMAIL_SECRET;
  if (!secret) { log("ACTIVATION_EMAIL_SECRET is not set, so the return emails stay off."); return; }
  if (mode === "on" && !process.env.RESEND_API_KEY) { log("RESEND_API_KEY is not set, so the return emails stay off."); return; }
  started = true;
  const siteUrl = process.env.SITE_URL || "https://www.klyp.world";
  log(`started in ${mode} mode`);

  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runReturnEmails(realDeps(), { mode, siteUrl, secret });
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
