import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the caption style card is its own positioning box, so the Pro diamond sits on the card all the time (not only on hover)", () => {
  const css = read("components/clip-timeline-editor.css");
  const rule = css.split("\n").find((line) => line.startsWith(".clip-editor .caption-template-card {"));
  assert.ok(rule, "base card rule exists");
  assert.match(rule, /position:\s*relative/);
  // The diamond is absolutely placed inside the card, and it is the card's own child.
  assert.match(read("components/CaptionTemplatePicker.tsx"), /<StyleDiamond style=\{style\} size=\{24\} className="right-1\.5 top-1\.5 z-10" \/>/);
});
