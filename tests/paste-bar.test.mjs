import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the link box and Find Clips sit in one glowing bar, with the button beside the box (under it on a phone)", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('<div className="paste-bar" data-empty={url === "" ? "true" : "false"}>'));
  assert.ok(panel.includes('className="paste-bar-button w-full sm:w-auto"'));
  assert.ok(panel.includes('{loading ? "Analyzing…" : "✦ Find Clips"}'));
  const css = read("app/globals.css");
  assert.ok(css.includes(".paste-bar {") && css.includes("flex-direction: column;"), "stacked on a phone");
  assert.ok(css.includes("@media (min-width: 640px)") && css.includes("flex-direction: row;"), "side by side from tablet width");
});

test("the glow only breathes for people who have not asked for less motion, and the button is quiet until there is a link", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes("@media (prefers-reduced-motion: no-preference)") && css.includes('.paste-bar[data-empty="true"] { animation: paste-bar-glow'));
  assert.ok(css.includes(".paste-bar-button:disabled { cursor: not-allowed; opacity: 0.5; box-shadow: none;"));
});

test("the file-upload mode keeps its own Find Clips button, so there is never a second one next to the link box", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('{inputMode === "file" && <div className="mt-3 flex justify-end">'));
  assert.equal((panel.match(/type="submit" disabled=\{!canSubmit && !outOfSparks\}/g) ?? []).length, 2, "one in the bar, one for uploads");
});

test("the animated hint lines up with the bigger text in the bar", () => {
  const hint = read("components/PasteBoxHint.tsx");
  assert.ok(hint.includes("absolute inset-y-0 left-4 right-4") && hint.includes("text-[15px]"));
});
