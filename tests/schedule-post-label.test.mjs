import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../components/ClipTimelineEditor.tsx", import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the editor button says Schedule post, with Coming soon for everyone except the owner's account", () => {
  assert.ok(editor.includes("Schedule post{!complimentaryPro ? ' · Coming soon' : !pro ? ' · Pro' : ''}"));
  assert.ok(editor.includes("{ tier, complimentaryPro } = useSparks()"));
  assert.ok(!editor.includes("Schedule to YouTube"));
});
