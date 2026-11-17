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

test("the pop-up shows the cheap way in this person is offered, always with the $28 and the cancel rule", async () => {
  const { rawOfferFrom, rawOfferCopy, dollars } = await import("../lib/raw-pro.ts");
  const pass = rawOfferFrom({ trial: { days: 4, sparks: 250, price_cents: 300 }, first_month: { price_cents: 1700 } });
  assert.deepEqual(pass, { kind: "trial", days: 4, sparks: 250, cents: 300 }, "the 4-day pass wins over the first month");
  const copy = rawOfferCopy(pass);
  assert.equal(copy.button, "Start for $3");
  assert.ok(copy.heading.includes("4-day Pro pass: $3"));
  assert.ok(copy.detail.includes("$28 a month unless you cancel first") && copy.detail.includes("250 Sparks"));
  const month = rawOfferFrom({ trial: null, first_month: { price_cents: 1700 } });
  assert.deepEqual(month, { kind: "first_month", cents: 1700 });
  const monthCopy = rawOfferCopy(month);
  assert.equal(monthCopy.button, "Start for $17");
  assert.ok(monthCopy.detail.includes("$28 a month") && monthCopy.detail.includes("Cancel any time"));
  for (const odd of [null, undefined, {}, { trial: null, first_month: null }, { trial: { days: "4", sparks: 250, price_cents: 300 } }, { trial: { days: 4, sparks: 250, price_cents: 0 } }, "x"]) {
    assert.deepEqual(rawOfferFrom(odd), { kind: "none" });
  }
  assert.equal(rawOfferCopy({ kind: "none" }), null);
  assert.equal(dollars(300), "$3");
  assert.equal(dollars(1750), "$17.50");
});

test("the pop-up starts checkout in one click for an offered pass, and otherwise links to the Pro plans", () => {
  const modal = read("components/RawProModal.tsx");
  assert.ok(modal.includes('fetch("/api/stripe/checkout").then((r) => r.json())'));
  assert.ok(modal.includes('body: JSON.stringify({ interval: "month" })'));
  assert.ok(modal.includes("window.location.href = data.url;"));
  assert.ok(modal.includes('href="/dashboard/upgrade"'), "no offer means the Pro plans page");
  assert.ok(modal.includes('source: "raw_pro_modal"'));
});
