import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RAW_PRO_BODY, RAW_PRO_MESSAGE, RAW_PRO_TITLE } from "../lib/raw-pro.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("both export routes refuse a raw download from a Free account, with the same message the screen uses", () => {
  for (const file of ["app/api/clip/route.ts", "lib/legacy-clip-export-route.ts"]) {
    const src = read(file);
    assert.ok(src.includes("if (raw && !isPro) {"), `${file} refuses Free raw`);
    assert.ok(src.includes('code: "raw_pro_only" }, { status: 403 }'), `${file} answers 403 raw_pro_only`);
    assert.ok(src.includes(JSON.stringify(RAW_PRO_MESSAGE)), `${file} uses the shared wording`);
  }
  // The refusal comes before any clip lookup or source work.
  const route = read("app/api/clip/route.ts");
  assert.ok(route.indexOf("if (raw && !isPro) {") < route.indexOf("A raw download of a saved clip goes through"));
});

test("the shared hook sends a Free member to the pop-up instead of requesting a raw download", () => {
  const hook = read("components/useRawClipDownloads.ts");
  assert.ok(hook.includes("const rawLocked = useRawLocked();"));
  assert.ok(hook.includes("if (rawLocked) { setRawLockOpen(true); return; }"));
  assert.ok(hook.includes("rawLockOpen, closeRawLock"));
  for (const screen of ["components/SavedClips.tsx", "app/(dashboard)/dashboard/clips/page.tsx", "app/(dashboard)/dashboard/analytics/page.tsx"]) {
    const src = read(screen);
    assert.ok(src.includes("rawLockOpen, closeRawLock"), `${screen} reads the pop-up state`);
    assert.ok(src.includes("{rawLockOpen && <RawProModal onClose={closeRawLock} />}"), `${screen} shows the pop-up`);
  }
});

test("the analyze panel's own Raw buttons open the pop-up for Free", () => {
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes("onRawExport={() => { if (rawLocked) setRawLockOpen(true); else void downloadClip(clip, i, undefined, true); }}"));
  assert.ok(panel.includes("onDownloadRaw={() => { if (rawLocked) setRawLockOpen(true); else void downloadClip(clips[previewIndex], previewIndex, undefined, true); }}"));
  assert.ok(panel.includes("{rawLockOpen && <RawProModal onClose={() => setRawLockOpen(false)} />}"));
});

test("every Raw button shows the lock and PRO tag for Free", () => {
  for (const file of ["components/CompactClipCard.tsx", "components/FoundClipCard.tsx", "components/ClipPreviewModal.tsx", "components/ResultsClipPreviewModal.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("useRawLocked()"), `${file} knows the plan`);
    assert.ok(src.includes("<RawLockBadge"), `${file} shows the lock badge`);
  }
});

test("the lock only shows once the plan is known, never for Pro", () => {
  const src = read("components/useRawLocked.ts");
  assert.ok(src.includes('return balance !== null && tier !== "pro";'));
});

test("the pop-up uses the shared wording and sends people to the Pro plans", () => {
  const modal = read("components/RawProModal.tsx");
  assert.ok(modal.includes("RAW_PRO_TITLE") && modal.includes("RAW_PRO_BODY"));
  assert.ok(modal.includes('href="/dashboard/upgrade"'));
  assert.equal(RAW_PRO_TITLE, "Raw clips are for Pro");
  assert.ok(RAW_PRO_BODY.includes("no watermark") && RAW_PRO_BODY.includes("Klyp watermark"));
});
