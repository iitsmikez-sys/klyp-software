import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MIN_WINDOW_SECONDS, fmtWindowClock, fmtWindowLength, resolveRequestedWindow, snapWindow, tickHours, windowShortcut } from "../lib/vod-window.ts";

const H = 3600;
const CAP = 8 * H;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("shortcuts: first, middle and last window of a 24 hour video", () => {
  const total = 24 * H;
  assert.deepEqual(windowShortcut("first", total, CAP), { start: 0, end: 8 * H });
  assert.deepEqual(windowShortcut("middle", total, CAP), { start: 8 * H, end: 16 * H });
  assert.deepEqual(windowShortcut("last", total, CAP), { start: 16 * H, end: 24 * H });
});

test("a video shorter than the cap gets one window, the whole video", () => {
  assert.deepEqual(windowShortcut("middle", 6 * H, CAP), { start: 0, end: 6 * H });
});

test("the window can never be longer than the cap: the dragged handle stops and says so", () => {
  const total = 17 * H;
  const dragEnd = snapWindow({ kind: "end", seconds: 16 * H, grab: 0, start: 4 * H, end: 12 * H, totalSeconds: total, capSeconds: CAP });
  assert.equal(dragEnd.end - dragEnd.start, CAP);
  assert.equal(dragEnd.start, 4 * H);
  assert.equal(dragEnd.hitCap, true);
  const dragStart = snapWindow({ kind: "start", seconds: 0, grab: 0, start: 4 * H, end: 12 * H, totalSeconds: total, capSeconds: CAP });
  assert.equal(dragStart.end - dragStart.start, CAP);
  assert.equal(dragStart.hitCap, true);
});

test("handles stay inside the video and never cross (a 10 minute minimum)", () => {
  const total = 13 * H;
  const past = snapWindow({ kind: "end", seconds: 99 * H, grab: 0, start: 2 * H, end: 6 * H, totalSeconds: total, capSeconds: CAP });
  assert.equal(past.end, 10 * H); // 8 hours after the start at 2h
  const crossing = snapWindow({ kind: "start", seconds: 6 * H, grab: 0, start: 2 * H, end: 3 * H, totalSeconds: total, capSeconds: CAP });
  assert.equal(crossing.end - crossing.start, MIN_WINDOW_SECONDS);
  const negative = snapWindow({ kind: "start", seconds: -500, grab: 0, start: 2 * H, end: 4 * H, totalSeconds: total, capSeconds: CAP });
  assert.equal(negative.start, 0);
});

test("sliding the whole window keeps its length and stays inside the video", () => {
  const total = 13 * H;
  const slid = snapWindow({ kind: "move", seconds: 100 * H, grab: 4 * H, start: 0, end: 8 * H, totalSeconds: total, capSeconds: CAP });
  assert.deepEqual([slid.start, slid.end], [5 * H, 13 * H]);
  const back = snapWindow({ kind: "move", seconds: -5 * H, grab: 0, start: 5 * H, end: 13 * H, totalSeconds: total, capSeconds: CAP });
  assert.deepEqual([back.start, back.end], [0, 8 * H]);
});

test("the bar covers the real video: ticks and labels follow its length", () => {
  assert.deepEqual(tickHours(13 * H + 720), [0, 2, 4, 6, 8, 10, 12].filter((h) => (h * H) / (13 * H + 720) <= 0.9));
  assert.deepEqual(tickHours(17.5 * H), [0, 4, 8, 12]);
  assert.equal(fmtWindowLength(13 * H + 12 * 60), "13h 12m");
  assert.equal(fmtWindowClock(9 * H + 30 * 60), "9:30");
});

test("the server only honours a window for a video over the plan's length, and keeps it inside the video", () => {
  const ok = resolveRequestedWindow({ requestedStart: 4 * H, requestedSeconds: 8 * H, verifiedSeconds: 17 * H, capSeconds: CAP });
  assert.deepEqual(ok, { start: 4 * H, seconds: 8 * H });
  assert.equal(resolveRequestedWindow({ requestedStart: 0, requestedSeconds: 8 * H, verifiedSeconds: 6 * H, capSeconds: CAP }), null, "a video inside the limit has no window");
  assert.deepEqual(resolveRequestedWindow({ requestedStart: 0, requestedSeconds: 20 * H, verifiedSeconds: 17 * H, capSeconds: CAP }), { start: 0, seconds: CAP }, "length is capped");
  assert.deepEqual(resolveRequestedWindow({ requestedStart: 16 * H, requestedSeconds: 8 * H, verifiedSeconds: 17 * H, capSeconds: CAP }), { start: 9 * H, seconds: 8 * H }, "the start is pulled back inside the video");
  for (const bad of [{ requestedStart: -1, requestedSeconds: 8 * H }, { requestedStart: "x", requestedSeconds: 8 * H }, { requestedStart: 0, requestedSeconds: 60 }, { requestedStart: undefined, requestedSeconds: undefined }]) {
    assert.equal(resolveRequestedWindow({ ...bad, verifiedSeconds: 17 * H, capSeconds: CAP }), null);
  }
});

test("the route prices and runs the chosen part, and makes each part its own job", () => {
  const route = read("app/api/analyze/route.ts");
  assert.ok(route.includes("requestedWindow = { start: body.windowStart, seconds: body.windowSeconds };"));
  assert.ok(route.includes("...(windowAsked ? { window: [Math.round(askedStart), Math.round(askedSeconds)] } : {})"), "another part of the same video is a different job");
  assert.ok(route.includes('capSeconds: plan === "free" ? FREE_PART_SECONDS : maxSecondsFor(plan, sourceKind)'));
  assert.ok(route.includes("const partSeconds = chosenWindow ? chosenWindow.seconds :"));
  assert.ok(route.includes("windowStart: chosenWindow?.start,"));
});

test("the pipeline downloads only the chosen part and keeps parts apart in the result cache", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("if (partSeconds && opts.windowStart !== undefined) {"));
  assert.ok(pipeline.includes("downloadAudioWindow(url, workDir, { start: opts.windowStart, end: opts.windowStart + partSeconds }, 30 * 60_000)"));
  assert.ok(pipeline.includes("windows: [{ start: windowStart, end: durationSeconds }]"), "two parts that end at the same time do not share saved results");
  // The clip times are put back onto the whole video's timeline.
  assert.ok(pipeline.includes("start: w.start + windowStart * 1000"));
});

test("the panel shows the bar only for Pro on a video over 8 hours, prices the part, and sends it", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('const windowOffered = inputMode === "url" && isPro && !!planBlock && previewDuration !== null && previewDuration > proCapSeconds;'));
  assert.ok(panel.includes("<VodWindowPicker totalSeconds={previewDuration}"));
  assert.ok(panel.includes("windowStart: activeWindow.start, windowSeconds: activeWindow.end - activeWindow.start"));
  assert.ok(panel.includes("estimateSparks(activeWindow.end - activeWindow.start) + CLIP_COUNT_COST[clipCount]"));
  assert.ok(panel.includes("setProWindow(null);"), "a new link starts without the old part");
  const picker = read("components/VodWindowPicker.tsx");
  assert.ok(picker.includes('role="slider"'));
  assert.ok(picker.includes("totalSeconds"), "the bar is the video's own length");
});
