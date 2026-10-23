import assert from "node:assert/strict";
import test from "node:test";
import { authorizeLayoutWrite, effectiveVerticalLayout, layoutEditorState, parseVerticalLayoutWrite } from "./vertical-layout-auth.ts";

const a = { version: 1 as const, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
const b = { version: 1 as const, gameplay: { x: 0.1, y: 0, w: 0.8, h: 1 } };

test("only the signed-in owner may save a layout on either tier", () => {
  assert.equal(authorizeLayoutWrite(null, "a"), 401);
  assert.equal(authorizeLayoutWrite("a", "b"), 403);
  assert.equal(authorizeLayoutWrite("a", "a"), null);
});

test("missing or null draft uses current account default; saved override survives changes", () => {
  assert.deepEqual(effectiveVerticalLayout(a, undefined), a);
  assert.deepEqual(effectiveVerticalLayout(a, null), a);
  assert.deepEqual(effectiveVerticalLayout(a, b), b);
});

test("free layout changes must be saved to account before export", () => {
  assert.deepEqual(layoutEditorState(false, a, b, null), { preview: a, pending: null, exportBlocked: false });
  assert.deepEqual(layoutEditorState(false, a, b, b), { preview: b, pending: b, exportBlocked: true });
  assert.deepEqual(layoutEditorState(true, a, b, null), { preview: b, pending: null, exportBlocked: false });
});

test("account reset accepts null and invalid geometry is rejected", () => {
  assert.equal(parseVerticalLayoutWrite(null), null);
  assert.deepEqual(parseVerticalLayoutWrite(a), a);
  assert.throws(() => parseVerticalLayoutWrite({ version: 1, gameplay: { x: 0.9, y: 0, w: 0.2, h: 1 } }));
});
