import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cachedInsertPreview, prefetchInsertPreview, clearInsertPreviewCache } from "../lib/editor-insert-preview-cache.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const photo = { id: "a1", kind: "photo", status: "verified" };

function stubFetch(expiresIn = 300) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify({ asset: photo, preview_url: "https://signed/a1?token=1", expires_in: expiresIn }), { status: 200 });
  };
  return calls;
}

test("a prefetched insert is ready instantly and fetched only once, even for simultaneous callers", async () => {
  clearInsertPreviewCache();
  const calls = stubFetch();
  assert.equal(cachedInsertPreview("clip", "a1"), null);
  const [one, two] = await Promise.all([prefetchInsertPreview("clip", "a1"), prefetchInsertPreview("clip", "a1")]);
  assert.equal(one, two);
  assert.deepEqual(calls, ["/api/clips/clip/media/a1"]);
  const hit = cachedInsertPreview("clip", "a1");
  assert.equal(hit.url, "https://signed/a1?token=1");
  assert.equal(await prefetchInsertPreview("clip", "a1"), hit);
  assert.equal(calls.length, 1, "no second request while the link is valid");
});

test("an entry is dropped 30 seconds before its signed link expires, then fetched again", async () => {
  clearInsertPreviewCache();
  const calls = stubFetch(300);
  await prefetchInsertPreview("clip", "a1");
  const entry = cachedInsertPreview("clip", "a1");
  assert.ok(cachedInsertPreview("clip", "a1", entry.expiresAt - 31_000));
  assert.equal(cachedInsertPreview("clip", "a1", entry.expiresAt - 29_000), null);
  await prefetchInsertPreview("clip", "a1");
  assert.equal(calls.length, 2);
});

test("a failed fetch is not cached, so the next try asks again", async () => {
  clearInsertPreviewCache();
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(JSON.stringify({ error: "Media service unavailable." }), { status: 503 }); };
  await assert.rejects(() => prefetchInsertPreview("clip", "a1"), /unavailable/);
  await assert.rejects(() => prefetchInsertPreview("clip", "a1"), /unavailable/);
  assert.equal(attempts, 2);
});

test("the editor loads inserted media ahead of time and the preview uses the cache", () => {
  const editor = read("components/ClipTimelineEditor.tsx");
  assert.ok(editor.includes("prefetchInsertPreview(clip.id, item.asset_id)"));
  const preview = read("components/EditorInsertedPreview.tsx");
  assert.ok(preview.includes("cachedInsertPreview(clipId,id)") && preview.includes("prefetchInsertPreview(clipId,id)"));
  assert.ok(!preview.includes("fetch(`/api/clips"), "no on-demand fetch left in the preview");
});
