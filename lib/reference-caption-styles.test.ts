import test from "node:test";
import assert from "node:assert/strict";
import { CAPTION_STYLES } from "./clips.ts";
import { captionMotion, captionAssMotionAt } from "./caption-template-motion.ts";
import { captionAppearance, generateAss, generateTimedCueAss, keywordAtTime, layoutTimedCaption } from "./captions.ts";

const appearance = captionAppearance({ caption_color: "white", caption_position: "bottom" });

test("comic and keyword are available as original caption styles", () => {
  assert.ok(CAPTION_STYLES.includes("COMIC"));
  assert.ok(CAPTION_STYLES.includes("KEYWORD"));
  assert.ok(captionMotion("COMIC", 0).scale < 1);
  assert.equal(captionMotion("COMIC", 300).scale, 1);
  assert.match(captionAssMotionAt("COMIC", 540, 1500, 1920), /\\fscx/);
});

test("comic exports yellow italic text with a dark outline", () => {
  const ass = generateTimedCueAss([{ text: "specific anime", start_ms: 0, end_ms: 900 }], "COMIC", appearance);
  assert.match(ass, /Style: Default,[^\n]*&H0000DFFF,[^\n]*,1,1,0,0,100,100/);
  assert.match(ass, /\\fscx/);
  const layout = layoutTimedCaption("specific anime", "COMIC", appearance);
  assert.equal(layout.italic, true);
});

test("keyword advances the green word throughout an edited caption", () => {
  assert.equal(keywordAtTime(0, 900, 3), 0);
  assert.equal(keywordAtTime(350, 900, 3), 1);
  assert.equal(keywordAtTime(800, 900, 3), 2);
  const ass = generateTimedCueAss([{ text: "been so fortunate", start_ms: 0, end_ms: 900 }], "KEYWORD", appearance);
  const events = ass.split("\n").filter(line => line.startsWith("Dialogue:"));
  assert.equal(events.length, 3);
  assert.match(events[0], /\{\\c&H00A0E500&\}been\{\\c&H00FFFFFF&\} so fortunate/);
  assert.match(events[1], /been \{\\c&H00A0E500&\}so\{\\c&H00FFFFFF&\} fortunate/);
  assert.match(events[2], /been so \{\\c&H00A0E500&\}fortunate/);
});

test("keyword timing and colors also export from direct clips", () => {
  const ass = generateAss([
    { text: "been", start: 0, end: 200 }, { text: "so", start: 210, end: 390 },
    { text: "fortunate", start: 400, end: 700 },
  ], 0, 1000, "KEYWORD");
  assert.equal(ass.split("\n").filter(line => line.startsWith("Dialogue:")).length, 3);
  assert.match(ass, /&H00A0E500&/);
});
