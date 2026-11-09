import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestWindowStart } from "../lib/best-window.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const HOUR = 3600, WINDOW = 119 * 60;

/** A stream at -30 LUFS with loud stretches (-10) at the given [startSecond, endSecond] ranges, one reading per 100 ms. */
function stream(totalSeconds, loud = []) {
  const samples = [];
  for (let t = 0; t < totalSeconds; t += 0.1) {
    const isLoud = loud.some(([a, b]) => t >= a && t < b);
    samples.push({ t, m: isLoud ? -10 : -30 });
  }
  return samples;
}

test("it picks the stretch that holds the most lively moments, not the start", () => {
  // A 5 hour stream: quiet for the first 3 hours, then a very lively last 2.
  const loud = []; for (let s = 3.2 * HOUR; s < 4.9 * HOUR; s += 300) loud.push([s, s + 20]);
  const start = bestWindowStart(stream(5 * HOUR, loud), 5 * HOUR, WINDOW);
  assert.ok(start >= 2.9 * HOUR && start <= 3 * HOUR + 60, `start ${start}`);
  assert.equal(start % 60, 0, "a whole minute");
  assert.ok(start + WINDOW <= 5 * HOUR, "the window stays inside the video");
});

test("when nothing stands out, or the signal is missing, it uses the very start", () => {
  assert.equal(bestWindowStart(stream(5 * HOUR, []), 5 * HOUR, WINDOW), 0);
  assert.equal(bestWindowStart([], 5 * HOUR, WINDOW), 0);
  assert.equal(bestWindowStart(stream(60), 60, 30), 0, "too few readings to trust");
});

test("a video no longer than the window has nowhere to slide", () => {
  assert.equal(bestWindowStart(stream(2 * HOUR, [[3000, 3100]]), 2 * HOUR, WINDOW), 0);
});

test("ties go to the earliest stretch, and one huge noise cannot outweigh steady liveliness", () => {
  const a = bestWindowStart(stream(5 * HOUR, [[600, 700], [3.5 * HOUR, 3.5 * HOUR + 100]]), 5 * HOUR, WINDOW);
  assert.ok(a <= 60, `equal bursts: the earlier wins, got ${a}`);
  // One 3 minute blast late on versus many short lively bursts early: the bursts win.
  const bursts = []; for (let s = 0.5 * HOUR; s < 1.5 * HOUR; s += 120) bursts.push([s, s + 15]);
  const start = bestWindowStart(stream(5 * HOUR, [...bursts, [4.5 * HOUR, 4.5 * HOUR + 180]]), 5 * HOUR, WINDOW);
  assert.ok(start <= 0.5 * HOUR + 60, `start ${start}`);
});

test("the pipeline scans the loudness, takes the best part, and puts words back on the video's own timeline", () => {
  const p = read("lib/analyze-pipeline.ts");
  assert.ok(p.includes("readLoudSamples(full,"));
  assert.ok(p.includes("windowStart = bestWindowStart(samples, opts.sourceSeconds ?? partSeconds, partSeconds);"));
  assert.ok(p.includes("start: w.start + windowStart * 1000, end: w.end + windowStart * 1000"));
  assert.ok(p.includes("durationSeconds = windowStart + result.durationSeconds;"));
  assert.ok(p.includes("const observedPart = partSeconds ? [{ start: windowStart, end: durationSeconds }] : undefined;"));
  assert.equal(p.split("opts.costRunId, observedPart, opts.model").length - 1, 2, "both clip-finder calls know only the part was transcribed");
  assert.ok(p.includes("start_seconds: m.start_seconds + windowStart"), "loud-moment hints shifted too");
  assert.ok(read("app/api/analyze/route.ts").includes("sourceSeconds: verifiedDuration"));
});

test("the price follows the part, the clip times follow the video: billed seconds go to the database only for a real offset", () => {
  const jobs = read("lib/analysis-jobs.ts");
  assert.ok(jobs.includes("billedSeconds && durationSeconds - billedSeconds > 120 ? { p_billed_seconds: billedSeconds } : {}"));
  assert.ok(read("app/api/analyze/route.ts").includes("clipCount, partSeconds);"));
  const sql = read("supabase/migrations/050_analysis_window_billing.sql");
  for (const piece of [
    "p_billed_seconds double precision default null",
    "v_billed := coalesce(p_billed_seconds, p_duration_seconds);",
    "or v_end > p_duration_seconds" , 
  ]) { if (piece.startsWith("or ")) continue; assert.ok(sql.includes(piece), piece); }
  assert.ok(sql.includes("v_end > p_duration_seconds"), "clip times are still checked against the video's own timeline");
  assert.ok(sql.includes("when v_billed < 7200 then 50") && sql.includes("when v_billed <= 14400 then 65"), "same price table as migration 045");
  assert.ok(sql.includes("p_billed_seconds <= 0 or p_billed_seconds > p_duration_seconds"));
  assert.equal((sql.match(/drop function if exists/g) ?? []).length, 4, "old signatures dropped so a call is never ambiguous");
  assert.equal((sql.match(/grant execute on function/g) ?? []).length, 2);
  assert.ok(sql.includes("record_analysis_clips(\n    v_job.source_key, p_clips, p_duration_seconds, p_requested_clips, p_billed_seconds)"));
});

test("the pop-up now says best 2 hours", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("Clip the best {PLAN_LIMITS.free.youtube / 3600} hours"));
  assert.ok(panel.includes("Use the best {PLAN_LIMITS.free.youtube / 3600} hours"));
  assert.ok(panel.includes("Clipping the best {PLAN_LIMITS.free.youtube / 3600} hours of this"));
});

test("on the warning box a free person gets Smart pick instead of being sent away; Pro still gets 'Try a shorter video'", () => {
  const panel = read("components/AnalyzePanel.tsx");
  const start = panel.indexOf("{isPro ? (\n                      <button type=\"button\" onClick={() => setUrl(\"\")}");
  assert.ok(start > 0, "the Pro branch keeps the old button");
  const block = panel.slice(start, start + 1100);
  assert.ok(block.includes("Try a shorter video"));
  assert.ok(block.includes("setFirstPartFor(url)"));
  assert.ok(block.includes("Clip the best {PLAN_LIMITS.free.youtube / 3600} hours, free"));
});
