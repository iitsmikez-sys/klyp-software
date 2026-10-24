/** Authenticated real-VOD smoke test using an existing example.com account. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loginExistingTestAccount } from "./smoke-auth.mjs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) =>
  value.startsWith("--") ? [[value.slice(2), all[index + 1]]] : []));
const email = args.email;
const { admin, user, token } = await loginExistingTestAccount(email);
const { data: profile, error: profileError } = await admin.from("profiles")
  .select("sparks,tier").eq("id", user.id).single();
if (profileError) throw profileError;
console.log(JSON.stringify({ authenticated: true, sparks: profile.sparks, tier: profile.tier }));
if (args["auth-only"] !== undefined) process.exit(0);

const contentType = args.content;
if (!["gaming", "irl"].includes(contentType)) throw new Error("Pass --content gaming|irl.");
const base = args.base ?? "http://127.0.0.1:3018";
let requestBody;
if (args.file) {
  const bytes = readFileSync(args.file);
  const uploaded = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`,
      "x-file-name": encodeURIComponent(path.basename(args.file)) },
    body: bytes,
  });
  const value = await uploaded.json();
  if (!uploaded.ok) throw new Error(`Upload HTTP ${uploaded.status}: ${JSON.stringify(value).slice(0, 400)}`);
  console.log(JSON.stringify({ uploaded: true, durationSeconds: value.durationSeconds }));
  requestBody = { url: "", uploadId: value.uploadId,
    durationHint: value.durationSeconds, clipCount: 3, contentType };
} else {
  const videoUrl = args.url;
  const durationHint = Number(args.duration);
  if (!/^https:\/\/www\.twitch\.tv\/videos\/\d+$/.test(videoUrl ?? "")
    || !Number.isFinite(durationHint) || durationHint < 60) {
    throw new Error("Pass --url Twitch VOD and --duration seconds, or --file local-video.mp4.");
  }
  requestBody = { url: videoUrl, durationHint, clipCount: 3, contentType };
}
const response = await fetch(`${base}/api/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(requestBody),
});
if (!response.ok) throw new Error(`Analyze HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
if (!response.body) throw new Error("Missing analysis event stream.");
let buffer = "";
let result;
for await (const chunk of response.body) {
  buffer += new TextDecoder().decode(chunk);
  const events = buffer.split("\n\n");
  buffer = events.pop() ?? "";
  for (const event of events) {
    const line = event.split("\n").find((part) => part.startsWith("data: "));
    if (!line) continue;
    const payload = JSON.parse(line.slice(6));
    if (payload.type === "progress") console.log(`${payload.stage}: ${payload.status}`);
    if (payload.type === "error") throw new Error(`${payload.stage}: ${payload.error}`);
    if (payload.type === "result") result = payload;
  }
}
if (!result) throw new Error("Analysis ended without a result.");
console.log(JSON.stringify({ complete: true, clips: result.clips.length,
  durationSeconds: result.durationSeconds, sparksSpent: result.sparksSpent,
  sparksBalance: result.sparksBalance }));
