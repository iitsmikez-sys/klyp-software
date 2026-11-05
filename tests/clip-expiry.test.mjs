import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isMediaExpired, vodExpiry, dayWord, EXPIRY_WARNING_DAYS } from "../lib/clip-expiry.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const DAY = 86_400_000, NOW = Date.parse("2026-11-05T12:00:00Z");
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

test("footage is expired when it is marked expired or its date has passed, even before cleanup runs", () => {
  assert.equal(isMediaExpired({ archive_status: "expired" }, NOW), true);
  assert.equal(isMediaExpired({ archive_status: "stored", media_expires_at: inDays(-0.01) }, NOW), true);
  assert.equal(isMediaExpired({ archive_status: "stored", media_expires_at: new Date(NOW).toISOString() }, NOW), true);
  assert.equal(isMediaExpired({ archive_status: "stored", media_expires_at: inDays(0.5) }, NOW), false);
  assert.equal(isMediaExpired({ archive_status: "stored", media_expires_at: null }, NOW), false);
  assert.equal(isMediaExpired({ media_expires_at: "garbage" }, NOW), false);
  assert.equal(isMediaExpired(null, NOW), false);
  assert.equal(isMediaExpired(undefined, NOW), false);
});

test("a VOD card is grey with time, amber in the last 2 days, red once every clip has expired", () => {
  const stored = (days) => ({ archive_status: "stored", media_expires_at: inDays(days) });
  assert.deepEqual(vodExpiry([stored(4.2)], NOW), { kind: "ok", daysLeft: 5 });
  assert.deepEqual(vodExpiry([stored(2.9)], NOW), { kind: "ok", daysLeft: 3 });
  assert.deepEqual(vodExpiry([stored(2)], NOW), { kind: "soon", daysLeft: EXPIRY_WARNING_DAYS });
  assert.deepEqual(vodExpiry([stored(0.2)], NOW), { kind: "soon", daysLeft: 1 });
  assert.deepEqual(vodExpiry([stored(-1)], NOW), { kind: "expired" });
  assert.deepEqual(vodExpiry([{ archive_status: "expired" }], NOW), { kind: "expired" });
  // Several clips: warn about the soonest one that is still live; expired only when all are gone.
  assert.deepEqual(vodExpiry([stored(-1), stored(1.5), stored(20)], NOW), { kind: "soon", daysLeft: 2 });
  assert.deepEqual(vodExpiry([stored(-1), { archive_status: "expired" }], NOW), { kind: "expired" });
  // Older saves with no date show nothing rather than a wrong date.
  assert.deepEqual(vodExpiry([{ archive_status: "stored", media_expires_at: null }], NOW), { kind: "none" });
  assert.deepEqual(vodExpiry([], NOW), { kind: "none" });
  assert.equal(dayWord(1), "1 day");
  assert.equal(dayWord(3), "3 days");
});

// ---- the server check, with a fake database ----
const accessCode = ts.transpileModule(read("lib/clip-access.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const core = await import("../lib/clip-access-core.ts");
const expiry = await import("../lib/clip-expiry.ts");
const sourceOf = (url) => (url.match(/(?:v=|youtu\.be\/)([\w-]{11})/) ?? [])[1] ? `youtube:${(url.match(/(?:v=|youtu\.be\/)([\w-]{11})/))[1]}` : null;

function access({ clips = [], history = [], r2 = "1", now = new Date().toISOString() } = {}) {
  const builder = (table) => {
    let rows = table === "clips" ? clips : history; const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      lte(col, val) { filters.push((r) => r[col] <= val); return api; },
      gte(col, val) { filters.push((r) => r[col] >= val); return api; },
      or() { filters.push((r) => r.archive_status === "expired" || (r.media_expires_at && r.media_expires_at <= now)); return api; },
      limit() { return api; },
      then(resolve) { resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }); },
      async maybeSingle() { const m = rows.filter((r) => filters.every((f) => f(r))); return { data: m[0] ?? null, error: null }; },
    };
    return api;
  };
  const modules = {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: builder }) },
    "@/lib/vod-source": { vodSourceKey: (url) => sourceOf(url) },
    "@/lib/clip-access-core": { ...core, acquireUserProcessingSlot: () => () => {} },
    "@/lib/clip-expiry": expiry,
  };
  const exports = {};
  vm.runInNewContext(accessCode, { exports, require: (n) => modules[n], process: { env: { R2_ENABLED: r2 } }, Date, Error, Promise, Math, Number });
  return exports;
}
const URL1 = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
const clip = (over = {}) => ({ id: "c1", user_id: "u1", url: URL1, start_seconds: 100, end_seconds: 160, archive_status: "stored", media_expires_at: inDays(3 + (Date.now() - NOW) / DAY), ...over });
const past = new Date(Date.now() - 3600_000).toISOString();
const history = [{ user_id: "u1", source_key: "youtube:AAAAAAAAAAA", start_seconds: 100, end_seconds: 160 }];

test("a saved clip within its dates can be previewed and exported", async () => {
  const a = access({ clips: [clip()], history });
  assert.equal(await a.canProcessClip("u1", "c1", URL1, 100, 160), true);
});

test("a saved clip past its date is blocked right away, even though the cleanup job has not marked it", async () => {
  const a = access({ clips: [clip({ media_expires_at: past })], history });
  assert.equal(await a.canProcessClip("u1", "c1", URL1, 100, 160), false);
});

test("a clip already marked expired is blocked", async () => {
  const a = access({ clips: [clip({ archive_status: "expired" })], history });
  assert.equal(await a.canProcessClip("u1", "c1", URL1, 100, 160), false);
});

test("leaving out the clip id does not get around it: the same moment is still blocked once its saved copy expired", async () => {
  const a = access({ clips: [clip({ media_expires_at: past })], history });
  assert.equal(await a.canProcessClip("u1", "", URL1, 100, 160), false);
  assert.equal(await a.canProcessClip("u1", "wrong-id", URL1, 100, 160), false);
  assert.equal(await a.canProcessClip("u1", "", URL1, 110, 150), false, "a trimmed piece of it too");
});

test("another moment from the same video, or someone else's expired clip, is not affected", async () => {
  const other = [...history, { user_id: "u1", source_key: "youtube:AAAAAAAAAAA", start_seconds: 900, end_seconds: 960 }];
  const a = access({ clips: [clip({ media_expires_at: past })], history: other });
  assert.equal(await a.canProcessClip("u1", "", URL1, 900, 960), true);
  const b = access({ clips: [clip({ media_expires_at: past, user_id: "someone-else" })], history });
  assert.equal(await b.canProcessClip("u1", "", URL1, 100, 160), true);
});

test("without the retention migration the check still works from the status alone", async () => {
  const a = access({ r2: "0", clips: [clip({ archive_status: "expired" })], history });
  assert.equal(await a.canProcessClip("u1", "c1", URL1, 100, 160), false);
  assert.equal(await access({ r2: "0", clips: [clip()], history }).canProcessClip("u1", "c1", URL1, 100, 160), true);
});

test("the routes use the expiry rules: archive lookup, imported media, raw downloads, and the clip cards", () => {
  const archive = read("lib/clip-archive.ts");
  assert.match(archive, /media_expires_at/);
  assert.match(archive, /status: isMediaExpired\(row\) \? 'expired' : row\.archive_status/);
  assert.match(read("app/api/editor-media/route.ts"), /clip && clip\.status !== "expired" \? profile : null/);
  // A raw download that names a clip goes through the same ownership and expiry check as an export.
  assert.match(read("app/api/clip/route.ts"), /raw && !clipId \? !await canDownloadRawMoment\(profile\.id, url, start, end\) : !await canProcessClip\(profile\.id, clipId, url, start, end\)/);
  assert.doesNotMatch(read("app/api/clip/route.ts"), /raw \? \(!clipId && !await canDownloadRawMoment/);
  assert.match(read("lib/clip-ui.ts"), /isMediaExpired\(clip\)/);
  assert.match(read("components/CompactClipCard.tsx"), /isMediaExpired\(clip\) \? "expired" : clip\.archive_status/);
  assert.match(read("components/FoundClipCard.tsx"), /isMediaExpired\(clip\) \? 'expired' : clip\.archive_status/);
});

test("the library card shows the countdown, turns amber then red, and says Details once expired", () => {
  const page = read("app/(dashboard)/dashboard/streams/page.tsx");
  assert.match(page, /const expiry = vodExpiry\(vod\.clips\);/);
  assert.match(page, /Footage kept \{dayWord\(expiry\.daysLeft\)\} more/);
  assert.match(page, /Footage deleted in \{dayWord\(expiry\.daysLeft\)\}/);
  assert.match(page, /VOD expired · footage deleted/);
  assert.match(page, /expiry\.kind === "expired" \? "border-red-500\/40" : expiry\.kind === "soon" \? "border-amber-400\/50"/);
  assert.match(page, /Keep 30 days with Pro/);
  assert.match(page, /expiry\.kind === "expired" \? "Details" : "View clips"/);
  // The upgrade nudge for the last 2 days only shows to Free accounts.
  assert.ok((page.match(/\{!isPro && <Link href="\/dashboard\/upgrade"/g) ?? []).length === 1);
});

test("an expired card gets the red EXPIRED stamp, a blurred thumbnail and dimmed details", () => {
  const page = read("app/(dashboard)/dashboard/streams/page.tsx");
  // The stamp: big, red, tilted, in the middle of the card, and it never blocks a click.
  assert.match(page, /\{expiry\.kind === "expired" && \(\s*<>\s*<span className="sr-only" data-expiry="expired">VOD expired · footage deleted<\/span>/);
  assert.match(page, /data-expired-stamp className="pointer-events-none absolute left-1\/2 top-1\/2 -translate-x-1\/2 -translate-y-1\/2 -rotate-\[8deg\][^"]*border-4 border-red-500[^"]*text-red-500[^"]*">\s*EXPIRED\s*<\/div>/);
  assert.match(page, /relative overflow-hidden bg-surface border rounded-xl/);
  // Thumbnail blurred and grey and not clickable; title, stats and the button dimmed.
  assert.match(page, /expiry\.kind === "expired" \? "pointer-events-none blur-\[6px\] grayscale opacity-60" : ""/);
  assert.equal((page.match(/expiry\.kind === "expired" \? "opacity-55" : ""/g) ?? []).length, 2);
  assert.match(page, /expiry\.kind === "expired" \? "opacity-60" : ""/);
  // The old small red line is gone.
  assert.doesNotMatch(page, /Upgrade to keep clips next time/);
});
