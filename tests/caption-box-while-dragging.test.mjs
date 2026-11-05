import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the green caption/hook box shows only while it is being dragged or resized, not after", () => {
  const tsx = read("components/EditorTextPlacementOverlay.tsx");
  assert.ok(!tsx.includes("is-selected") && !tsx.includes("setSelected"), "no sticky selected state");
  assert.match(tsx, /setDragging\(true\);/);
  // The box turns off once the last finger or the mouse is released.
  const end = tsx.slice(tsx.indexOf("const end="), tsx.indexOf("const keyboard="));
  assert.match(end, /if\(pointers\.current\.size\)\{start\(\);return;\}\s*setDragging\(false\);/);
  assert.match(tsx, /className=\{`editor-text-handle \$\{dragging\?'is-dragging':''\}`\}/);
});

test("the styles keep the outline and label for dragging and keyboard focus only; hover shows just the small resize corner", () => {
  const css = read("components/clip-timeline-editor.css");
  const rules = css.split("\n").filter((line) => line.includes(".editor-text-handle"));
  const outline = rules.find((line) => line.includes("border:1px solid #66e5b1"));
  assert.ok(outline && outline.includes(".is-dragging") && outline.includes(":focus-visible") && !outline.includes(":hover") && !outline.includes("is-selected"));
  const label = rules.find((line) => line.includes(".editor-text-handle-label") && line.includes("opacity:1"));
  assert.ok(label && label.includes(".is-dragging") && !label.includes(":hover"));
  assert.ok(rules.some((line) => line.startsWith(".editor-text-handle:hover .editor-text-resize-handle { opacity:.7 }")));
  assert.ok(!css.includes("is-selected"));
});
