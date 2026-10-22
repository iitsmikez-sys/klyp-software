/** Restore missing captions and hook choices on clips saved before those fields
 * were persisted. Reads only the signed-in user's clip; an archived master is
 * preferred so recovery also works after the original VOD disappears. */
import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { bearerToken, getProfileFromToken } from "@/lib/profile-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { getArchivedClip, readArchivedObject } from "@/lib/clip-archive";
import { resolveSourceSegment } from "@/lib/video-cache";
import { resolveBin, run, FFMPEG_THREADS } from "@/lib/bin";
import { transcribe } from "@/lib/analyze-pipeline";
import { cleanRepairHooks, offsetRecoveredWords } from "@/lib/clip-repair";
import { runQueued } from "@/lib/job-queue";
import { withCors, corsPreflight } from "@/lib/cors";
import type { TimedWord } from "@/lib/clips";

export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = corsPreflight;

const clipIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const active = new Map<string, Promise<Response>>();
const hookSchema = z.object({ hooks: z.array(z.string()).length(3) });

async function generateHooks(title: string, caption: string | null, reason: string | null, words: TimedWord[]): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Hook generation is unavailable right now.");
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const client = new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 350,
    system: "Write exactly three distinct, punchy on-screen callout hooks for a short video. Each must be under eight words. Use only the supplied clip details and transcript; do not invent events. No hashtags or trailing punctuation.",
    messages: [{ role: "user", content: JSON.stringify({ title, caption, reason,
      transcript: words.map((word) => word.text).join(" ").slice(0, 5000) }) }],
    output_config: { format: zodOutputFormat(hookSchema) },
  });
  const text = response.content.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Hook generator returned no text.");
  const hooks = cleanRepairHooks(hookSchema.parse(JSON.parse(text)).hooks);
  if (!hooks) throw new Error("Hook generator returned invalid choices.");
  return hooks;
}

async function recover(clipId: string, userId: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: clip, error: lookupError } = await admin.from("clips")
    .select("id,url,title,caption,reason,start_seconds,end_seconds,words,hooks")
    .eq("id", clipId).eq("user_id", userId).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!clip) return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  const duration = Number(clip.end_seconds) - Number(clip.start_seconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180) {
    return NextResponse.json({ error: "Invalid clip duration." }, { status: 400 });
  }

  const missingWords = !Array.isArray(clip.words) || clip.words.length === 0;
  const missingHooks = !Array.isArray(clip.hooks) || clip.hooks.length === 0;
  if (!missingWords && !missingHooks) {
    return NextResponse.json({ words: clip.words, hooks: clip.hooks, repaired: false });
  }

  let words: TimedWord[] = missingWords ? [] : clip.words as TimedWord[];
  let hooks: string[] = missingHooks ? [] : clip.hooks as string[];
  const errors: string[] = [];

  if (missingWords) {
    if (!process.env.ASSEMBLYAI_API_KEY) {
      errors.push("Caption transcription is unavailable right now.");
    } else {
      const dir = await mkdtemp(path.join(tmpdir(), "klyp-repair-"));
      try {
        const audioPath = path.join(dir, "audio.m4a");
        await runQueued(`repair-audio:${clipId}`, async () => {
          let videoPath: string | null = null;
          let seek = 0;
          const archived = await getArchivedClip(clipId, userId);
          if (archived?.status === "stored" && archived.masterPath) {
            const bytes = await readArchivedObject(archived.masterPath);
            if (bytes) {
              videoPath = path.join(dir, "master.mp4");
              await writeFile(videoPath, bytes);
            }
          }
          if (!videoPath) {
            const segment = await resolveSourceSegment(clip.url, clip.start_seconds, clip.end_seconds);
            videoPath = segment.path;
            seek = Math.max(0, clip.start_seconds - segment.offsetSeconds);
          }
          await run(resolveBin("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", String(seek),
            "-t", String(duration), "-i", videoPath, "-map", "0:a:0", "-vn", "-c:a", "aac",
            "-b:a", "96k", "-threads", String(FFMPEG_THREADS), "-y", audioPath],
          { stallTimeoutMs: 30_000, maxRunMs: 5 * 60_000 });
        });
        const result = await transcribe(audioPath);
        words = offsetRecoveredWords(result.words, clip.start_seconds, duration);
        if (!words.length) throw new Error("No spoken words were found in this clip.");
      } catch (err) {
        errors.push(`Captions could not be restored: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }

  if (missingHooks) {
    try {
      hooks = await generateHooks(clip.title, clip.caption, clip.reason, words);
    } catch (err) {
      errors.push(`Hooks could not be restored: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const update: { words?: TimedWord[]; hooks?: string[] } = {};
  if (missingWords && words.length) update.words = words;
  if (missingHooks && hooks.length) update.hooks = hooks;
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: errors.join(" ") || "Nothing could be restored." }, { status: 422 });
  }
  const { error: saveError } = await admin.from("clips").update(update).eq("id", clipId).eq("user_id", userId);
  if (saveError) throw new Error(`Could not save restored captions and hooks: ${saveError.message}`);
  return NextResponse.json({ words, hooks, repaired: true, warning: errors.join(" ") || null });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== "processing") {
    return withCors(NextResponse.json({ error: "Not found." }, { status: 404 }));
  }
  const token = bearerToken(req);
  let profile;
  try { profile = token ? await getProfileFromToken(token) : null; }
  catch { return withCors(NextResponse.json({ error: "Could not verify your session." }, { status: 500 })); }
  if (!profile) return withCors(NextResponse.json({ error: "Sign in to repair clips." }, { status: 401 }));
  let clipId = "";
  try { clipId = String((await req.json()).clip_id ?? ""); } catch { /* rejected below */ }
  if (!clipIdPattern.test(clipId)) return withCors(NextResponse.json({ error: "Invalid clip id." }, { status: 400 }));
  const key = `${profile.id}:${clipId}`;
  let task = active.get(key);
  if (!task) {
    task = recover(clipId, profile.id);
    active.set(key, task);
    task.finally(() => active.delete(key)).catch(() => {});
  }
  try { return withCors((await task).clone()); }
  catch (err) {
    return withCors(NextResponse.json({ error: err instanceof Error ? err.message : "Clip repair failed." }, { status: 500 }));
  }
}
