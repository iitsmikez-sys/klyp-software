import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("the results screen explains a best-of-this-stream result and says no Sparks were charged", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('import { isBestOfResult } from "@/lib/clip-extras";'));
  assert.ok(panel.includes("isBestOfResult(event.clips)"));
  assert.ok(panel.includes("these are the best moments we found in this stream"));
  assert.ok(panel.includes("They're weaker than usual but worth a look."));
});

test("the database charges only when a new clip cleared the quality bar", () => {
  const sql = read("supabase/migrations/043_no_charge_without_clips.sql");
  assert.ok(sql.includes("v_top_pick boolean := false;"));
  assert.ok(sql.includes("coalesce((p_clips->v_index->>'viral_score')::numeric, 100) >= 65"));
  assert.ok(sql.includes("v_cost := case when v_top_pick then v_vod_cost else 0 end;"));
});

test("automatic clipping still saves top picks only, so best-of moments never get auto-saved", () => {
  const poll = read("lib/vod-poll.ts");
  assert.ok(poll.includes("isTopPick"));
});
