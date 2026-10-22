import test from "node:test";
import assert from "node:assert/strict";
import { authorizeClipDraftWrite } from "./clip-edit-auth.ts";

test("draft save requires a signed-in user", () => {
  assert.equal(authorizeClipDraftWrite(null, "owner", "pro", "sub_1"), 401);
});

test("another user's clip and missing clip are both hidden", () => {
  assert.equal(authorizeClipDraftWrite("attacker", "owner", "pro", "sub_1"), 404);
  assert.equal(authorizeClipDraftWrite("attacker", null, "pro", "sub_1"), 404);
});

test("draft save requires confirmed Pro billing", () => {
  assert.equal(authorizeClipDraftWrite("owner", "owner", "free", "sub_1"), 403);
  assert.equal(authorizeClipDraftWrite("owner", "owner", "pro", null), 403);
});

test("owned clip with confirmed Pro billing is editable", () => {
  assert.equal(authorizeClipDraftWrite("owner", "owner", "pro", "sub_1"), null);
});
