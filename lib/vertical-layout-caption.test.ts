import assert from "node:assert/strict";
import test from "node:test";
import { captionAppearance, generateAss, layoutTimedCaption, wrapCaptionText } from "./captions.ts";
import { planVerticalLayout } from "./vertical-layout.ts";

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

test("captions in a facecam-first clip land inside the gameplay panel", () => {
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, {
    version: 1, gameplay: { x: 0.2, y: 0, w: 0.8, h: 1 },
    facecam: { x: 0, y: 0, w: 0.25, h: 0.4 }, arrangement: "facecam_top",
  }, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "composed");
  if (plan.mode !== "composed") return;
  for (const position of ["top", "center", "bottom"] as const) {
    const caption = layoutTimedCaption("THAT WAS NOT EXPECTED", "BOLD", captionAppearance({ caption_color: "white", caption_position: position }), { w: 1080, h: 1920 }, plan.textSafe);
    assert.ok(caption.lines.every(line => line.y >= plan.textSafe.y && line.y <= plan.textSafe.y + plan.textSafe.h), position);
  }
});
