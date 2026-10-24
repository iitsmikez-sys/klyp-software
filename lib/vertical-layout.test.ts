import assert from "node:assert/strict";
import test from "node:test";
import { chatReadabilityWarning, clampSourceRect, planVerticalLayout, validateVerticalLayout } from "./vertical-layout.ts";

test("dragged boxes stay inside frame and tiny chat warns", () => {
  assert.deepEqual(clampSourceRect({ x: 0.9, y: -0.2, w: 0.2, h: 0.3 }), { x: 0.8, y: 0, w: 0.2, h: 0.3 });
  assert.equal(chatReadabilityWarning({ x: 0, y: 0, w: 0.2, h: 0.1 }, 1080), true);
  assert.equal(chatReadabilityWarning({ x: 0, y: 0, w: 0.2, h: 0.3 }, 1080), false);
});

const gameplay = { x: 0.1, y: 0.1, w: 0.7, h: 0.7 };
const facecam = { x: 0, y: 0.65, w: 0.2, h: 0.3 };
const chat = { x: 0.8, y: 0.1, w: 0.2, h: 0.7 };

test("rejects source rectangles that leave the frame or cannot be rendered", () => {
  for (const rect of [{ ...gameplay, x: 0.5 }, { ...gameplay, w: 0.01 }, { ...gameplay, x: NaN }]) {
    assert.throws(() => validateVerticalLayout({ version: 1, gameplay: rect }), /layout/i);
  }
});

test("same normalized source boxes scale with source resolution", () => {
  const layout = validateVerticalLayout({ version: 1, gameplay, facecam, chat });
  const a = planVerticalLayout({ w: 1280, h: 720 }, layout, { w: 1080, h: 1920 });
  const b = planVerticalLayout({ w: 1920, h: 1080 }, layout, { w: 1080, h: 1920 });
  assert.equal(a.mode, "composed");
  assert.equal(b.mode, "composed");
  if (a.mode !== "composed" || b.mode !== "composed") return;
  assert.deepEqual(a.panels.map((p) => p.dest), b.panels.map((p) => p.dest));
  assert.ok(Math.abs(b.panels[0].source.x - a.panels[0].source.x * 1.5) <= 2);
});

test("gameplay occupies the whole frame without optional panels", () => {
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, { version: 1, gameplay }, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "composed");
  if (plan.mode !== "composed") return;
  assert.deepEqual(plan.panels.map((p) => [p.name, p.dest]), [["gameplay", { x: 0, y: 0, w: 1080, h: 1920 }]]);
});

test("one optional panel takes the lower band and two split it", () => {
  const one = planVerticalLayout({ w: 1920, h: 1080 }, { version: 1, gameplay, facecam }, { w: 1080, h: 1920 });
  const two = planVerticalLayout({ w: 1920, h: 1080 }, { version: 1, gameplay, facecam, chat }, { w: 1080, h: 1920 });
  assert.equal(one.mode, "composed");
  assert.equal(two.mode, "composed");
  if (one.mode !== "composed" || two.mode !== "composed") return;
  assert.deepEqual(one.panels.map((p) => p.dest), [
    { x: 0, y: 0, w: 1080, h: 1344 }, { x: 0, y: 1344, w: 1080, h: 576 },
  ]);
  assert.deepEqual(two.panels.map((p) => p.dest), [
    { x: 0, y: 0, w: 1080, h: 1344 }, { x: 0, y: 1344, w: 540, h: 576 }, { x: 540, y: 1344, w: 540, h: 576 },
  ]);
});

test("facecam-first layout puts the speaker above gameplay and keeps captions in gameplay", () => {
  const layout = validateVerticalLayout({ version: 1, gameplay, facecam, arrangement: "facecam_top" });
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, layout, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "composed");
  if (plan.mode !== "composed") return;
  assert.deepEqual(plan.panels.map((panel) => [panel.name, panel.dest]), [
    ["facecam", { x: 0, y: 0, w: 1080, h: 576 }],
    ["gameplay", { x: 0, y: 576, w: 1080, h: 1344 }],
  ]);
  assert.deepEqual(plan.textSafe, { x: 0, y: 576, w: 1080, h: 1344 });
});

test("facecam-first layout shares the top strip with chat when chat is included", () => {
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, { version: 1, gameplay, facecam, chat, arrangement: "facecam_top" }, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "composed");
  if (plan.mode !== "composed") return;
  assert.deepEqual(plan.panels.map((panel) => [panel.name, panel.dest]), [
    ["facecam", { x: 0, y: 0, w: 540, h: 576 }],
    ["chat", { x: 540, y: 0, w: 540, h: 576 }],
    ["gameplay", { x: 0, y: 576, w: 1080, h: 1344 }],
  ]);
});

test("unknown panel arrangements are rejected", () => {
  assert.throws(() => validateVerticalLayout({ version: 1, gameplay, arrangement: "sideways" }), /layout/i);
});

test("absent layout fits the full source without cropping", () => {
  const plan = planVerticalLayout({ w: 1920, h: 1080 }, null, { w: 1080, h: 1920 });
  assert.equal(plan.mode, "full_frame");
  if (plan.mode !== "full_frame") return;
  assert.deepEqual(plan.source, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(plan.dest, { x: 0, y: 656, w: 1080, h: 608 });
});
