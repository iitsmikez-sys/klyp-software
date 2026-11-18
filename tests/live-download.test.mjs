import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_DOWNLOAD_REASON, LIVE_CHECK_AFTER_MS, LIVE_MIN_REMAINING_SECONDS, liveDownloadDetected, readProgress } from "../lib/live-download.ts";
import { run } from "../lib/bin.ts";
import { userFacingAnalysisError, LIVE_VOD_MESSAGE } from "../lib/analyze-errors.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const line = (mediaSeconds, speed) => {
  const h = String(Math.floor(mediaSeconds / 3600)).padStart(2, "0"), m = String(Math.floor((mediaSeconds % 3600) / 60)).padStart(2, "0"), s = (mediaSeconds % 60).toFixed(2).padStart(5, "0");
  return `size=   15360KiB time=${h}:${m}:${s} bitrate= 202.9kbits/s speed=${speed}x    \r`;
};
const progress = (speeds, start = 30) => speeds.map((sp, i) => line(start + i * 5, sp)).join("");
const HOUR = 3600;

test("progress lines are read for how much video arrived and how fast", () => {
  const readings = readProgress("d=1.04x size= 15360KiB time=00:10:20.01 bitrate= 202.9kbits/s speed=1.04x size= 100KiB time=01:00:05.50 bitrate=1kbits/s speed=14.2x");
  assert.deepEqual(readings, [{ mediaSeconds: 620.01, speed: 1.04 }, { mediaSeconds: 3605.5, speed: 14.2 }]);
  assert.deepEqual(readProgress("nothing here"), []);
});

test("a download going at the video's own playing speed, with a long way still to go, is stopped as a live stream", () => {
  const stderr = progress([1.02, 1.04, 1.03, 1.05, 1.04]);
  assert.equal(liveDownloadDetected(stderr, 70_000, 1 * HOUR + 5 * 60 + 45), true);
});

test("nothing is stopped too early, or when the pace is not about 1x, or when it would finish soon", () => {
  const live = progress([1.02, 1.04, 1.03, 1.05, 1.04]);
  assert.equal(liveDownloadDetected(live, LIVE_CHECK_AFTER_MS - 1, HOUR), false, "too early to judge");
  assert.equal(liveDownloadDetected(progress([14.1, 13.9, 15.2, 14.4, 14.0]), 70_000, 5 * HOUR), false, "a fast download is fine");
  assert.equal(liveDownloadDetected(progress([0.2, 0.3, 0.25, 0.3, 0.2]), 70_000, 5 * HOUR), false, "a very slow one is a bad connection, not a live stream");
  assert.equal(liveDownloadDetected(progress([1.0, 1.0, 3.5, 1.0, 1.0]), 70_000, 5 * HOUR), false, "one fast reading in the recent ones means it is not pinned at real time");
  assert.equal(liveDownloadDetected(progress([1.02, 1.04, 1.03]), 70_000, HOUR), false, "needs a few readings");
  assert.equal(liveDownloadDetected(live, 70_000, undefined), false, "without the video's length nothing is stopped");
  assert.equal(liveDownloadDetected(live, 70_000, 0), false);
  // a 10 minute video at real time finishes in under 10 more minutes: let it
  assert.equal(liveDownloadDetected(progress([1.0, 1.0, 1.0, 1.0, 1.0], 60), 70_000, 10 * 60), false, "short enough to finish soon");
  assert.equal(liveDownloadDetected(progress([1.0, 1.0, 1.0, 1.0, 1.0], 60), 70_000, 12 * 60), true, "a 12 minute one would take over 10 more minutes at this pace");
  assert.ok(LIVE_MIN_REMAINING_SECONDS >= 300);
});

test("the process runner stops a process as soon as the check says so, and reports the reason", async () => {
  const script = `let i=0;const t=setInterval(()=>{process.stderr.write("size= 1KiB time=00:01:"+String(10+i).padStart(2,"0")+".00 bitrate=1kbits/s speed=1.01x\\r");i++;},50);setTimeout(()=>clearInterval(t),30000);`;
  const started = Date.now();
  await assert.rejects(
    () => run(process.execPath, ["-e", script], { abortWhen: (stderr) => (readProgress(stderr).length >= 4 ? LIVE_DOWNLOAD_REASON : null), maxRunMs: 20_000 }),
    (error) => { assert.match(error.message, /downloading only as fast as the stream plays/); return true; },
  );
  assert.ok(Date.now() - started < 8_000, "it did not wait for the process to finish");
});

test("a stopped live download is shown as the plain live-stream message", () => {
  const raw = `yt-dlp ${LIVE_DOWNLOAD_REASON}. stderr: size= 15360KiB time=00:01:12.00 bitrate= 202.9kbits/s speed=1.04x`;
  assert.equal(userFacingAnalysisError("download", "https://www.twitch.tv/videos/2932151237", raw), LIVE_VOD_MESSAGE);
});

test("the audio download checks for a live stream using the video's length, and a live stream is not retried", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("abortWhen: (stderr, elapsedMs) => (liveDownloadDetected(stderr, elapsedMs, expectedSeconds) ? LIVE_DOWNLOAD_REASON : null),"));
  assert.ok(pipeline.includes("opts.sourceSeconds ?? durationHint);"));
  const bin = read("lib/bin.ts");
  assert.ok(bin.includes("if (message.includes(LIVE_DOWNLOAD_REASON)) throw err;"), "no second try that waits another minute");
  assert.ok(bin.includes("opts.abortWhen(stderr, Date.now() - startedAt)"));
});
