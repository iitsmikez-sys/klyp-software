import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a Free account that tries another video it cannot afford sees the pass first, with the pending video", () => {
  const dialog = read("components/FreeVideoUsedDialog.tsx");
  assert.ok(dialog.includes("You've used your free video"));
  assert.ok(dialog.includes('<ProOfferCta source="free_video_used"'), "the one-click offer, which always states the $28 and the cancel rule");
  assert.ok(dialog.includes("data-pending-video") && dialog.includes("This one is ready to clip. Run it with a Pro pass."));
  assert.ok(dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"') && dialog.includes('aria-label="Close"'));
});

test("buying a few Sparks is still one step away, and a missing picture falls back to a plain banner", () => {
  const dialog = read("components/FreeVideoUsedDialog.tsx");
  assert.ok(dialog.includes("Just need a few Sparks? See Spark packs") && dialog.includes("<OutOfSparksDialog isPro={false}"));
  assert.ok(dialog.includes('"/second-video.png"') && dialog.includes("onError={() => setImageOk(false)}"));
  assert.ok(dialog.includes('trackEvent("free_video_used_view"'));
});

test("Find Clips opens it when the balance is short (none left, or fewer than the video costs), Free only; Pro keeps the packs", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("const needsMoreSparks = outOfSparks || cantAfford;"));
  assert.ok(panel.includes("{sparksDialog && needsMoreSparks && (() => {"));
  assert.ok(panel.includes("? <OutOfSparksDialog isPro={isPro}") && panel.includes(": <FreeVideoUsedDialog balance={balance}"));
  assert.ok(panel.includes('import FreeVideoUsedDialog from "./FreeVideoUsedDialog";'));
});
