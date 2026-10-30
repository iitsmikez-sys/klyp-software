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

test("owned clips can be edited on Free and Pro", () => {
  assert.equal(authorizeClipDraftWrite("owner", "owner", "free", null), null);
  assert.equal(authorizeClipDraftWrite("owner", "owner", "pro", null), null);
});

test("owned clip with confirmed Pro billing is editable", () => {
  assert.equal(authorizeClipDraftWrite("owner", "owner", "pro", "sub_1"), null);
});
