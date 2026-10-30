/** Verify archived preview and export with the original upload unavailable. */
import { existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginExistingTestAccount } from "./smoke-auth.mjs";

const [, , email, clipId, base = "http://127.0.0.1:3020"] = process.argv;
if (!/^[0-9a-f-]{36}$/i.test(clipId ?? "")) throw new Error("Pass test email and clip UUID.");
const { admin, user, token } = await loginExistingTestAccount(email);
const { data: clip, error } = await admin.from("clips")
  .select("id,url,title,start_seconds,end_seconds,archive_status,master_path,proxy_path")
  .eq("id", clipId).eq("user_id", user.id).single();
if (error) throw error;
if (clip.archive_status !== "stored" || !clip.master_path || !clip.proxy_path ||
    !/^upload:[0-9a-f-]{36}$/i.test(clip.url)) {
  throw new Error("Expected a stored archive for the test upload.");
}
const cache = path.join(tmpdir(), "klyp-videos");
const original = path.join(cache, `upload-${clip.url.slice(7)}.mp4`);
const hidden = `${original}.hidden`;
if (existsSync(hidden)) throw new Error("Original upload is already hidden.");
const shouldHideOriginal = existsSync(original);
const payload = { clip_id: clip.id, url: clip.url,
  start_seconds: Number(clip.start_seconds), end_seconds: Number(clip.end_seconds) };
if (shouldHideOriginal) renameSync(original, hidden);
try {
  for (const endpoint of ["preview", "clip"]) {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(endpoint === "clip" ? { ...payload, title: "Archive smoke", aspect_ratio: "9:16" } : payload),
    });
    if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 100_000 || response.headers.get("content-type") !== "video/mp4") {
      throw new Error(`${endpoint} returned invalid video.`);
    }
    const source = response.headers.get("x-klyp-source");
    if (endpoint === "preview" && source !== "archive") throw new Error("Preview did not use archived proxy.");
    console.log(JSON.stringify({ endpoint, success: true, bytes: bytes.byteLength, source }));
  }
} finally {
  if (shouldHideOriginal) renameSync(hidden, original);
}
