import assert from "node:assert/strict";
import test from "node:test";
import { generateAss, wrapCaptionText } from "./captions.ts";

test("composed captions stay above the facecam and chat band", () => {
  const ass = generateAss([{ text: "wow", start: 0, end: 500 }], 0, 1000, "BOLD", { w: 1080, h: 1920 }, 576);
  assert.match(ass, /,2,10,10,656,1/);
});

test("long composed cues use the same explicit lines in ASS and preview", () => {
  const text = "THIS MOMENT WAS COMPLETELY UNBELIEVABLE";
  assert.deepEqual(wrapCaptionText(text, "BOLD"), ["THIS MOMENT WAS", "COMPLETELY", "UNBELIEVABLE"]);
  const ass = generateAss([{ text, start: 0, end: 500 }], 0, 1000, "BOLD", { w: 1080, h: 1920 }, 576, true);
  assert.match(ass, /THIS MOMENT WAS\\NCOMPLETELY\\NUNBELIEVABLE/);
});
