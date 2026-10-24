import test from "node:test";
import assert from "node:assert/strict";
import { chooseEditorDraft, normalizeLocalDraft } from "../lib/editor-draft-sync.ts";

test("an unsynced local draft survives the first cloud migration", () => {
  const local = normalizeLocalDraft({ hook: "my edit", segments: [{ start: 1, end: 10 }] });
  assert.equal(local.version, 1);
  assert.equal(chooseEditorDraft(local, null).source, "local");
});

test("a newer cloud draft beats a clean local cache", () => {
  const local = normalizeLocalDraft({ version: 1, hook: "old", cloudRevision: 1, dirty: false });
  const cloud = { revision: 2, draft: { version: 1, hook: "new" } };
  assert.equal(chooseEditorDraft(local, cloud).source, "cloud");
});

test("an unsynced local edit and a newer cloud revision surface a conflict", () => {
  const local = normalizeLocalDraft({ version: 1, hook: "mine", cloudRevision: 1, dirty: true });
  const cloud = { revision: 2, draft: { version: 1, hook: "other device" } };
  assert.equal(chooseEditorDraft(local, cloud).source, "conflict");
});
