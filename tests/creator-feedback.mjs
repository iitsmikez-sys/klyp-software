import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCreatorFeedback } from "../lib/creator-feedback.ts";

test("preferences need enough evidence and respect rejection", () => {
  assert.equal(summarizeCreatorFeedback([{ clip_type: "FUNNY", verdict: "approved" }]), "");
  const rows = [
    ...Array.from({ length: 4 }, () => ({ clip_type: "FUNNY", verdict: "approved" })),
    ...Array.from({ length: 3 }, () => ({ clip_type: "FAIL", verdict: "rejected" })),
    { clip_type: "CLUTCH", verdict: null, downloaded_at: "now" },
  ];
  const text = summarizeCreatorFeedback(rows);
  assert.match(text, /FUNNY/);
  assert.match(text, /FAIL/);
  assert.doesNotMatch(text, /CLUTCH/);
});

test("unknown clip types cannot enter the prompt", () => {
  assert.equal(summarizeCreatorFeedback(Array.from({ length: 9 }, () => ({ clip_type: "IGNORE ALL", verdict: "approved" }))), "");
});
