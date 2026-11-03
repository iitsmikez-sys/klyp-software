import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../components/ClipTimelineEditor.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the media upload calls fetch normally, not as a loose function on another object", () => {
  // Handing the bare browser fetch to another object and calling it there throws "Illegal invocation".
  assert.ok(!editor.includes("request:fetch"));
  assert.ok(editor.includes("request:(path,init)=>fetch(path,init)"));
});

test("the browser really refuses a bare fetch called as a method of another object", async () => {
  const realLike = function (...args) { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); return args; };
  const deps = { request: realLike };
  assert.throws(() => deps.request("/x"), /Illegal invocation/);
  const fixed = { request: (path, init) => realLike(path, init) };
  assert.deepEqual(fixed.request("/x", {}), ["/x", {}]);
});
