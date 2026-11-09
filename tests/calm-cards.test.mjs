import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a clip whose frame has not arrived shows a finished-looking card, not error text or a Retry button", () => {
  const src = read("components/ClipThumbnail.tsx");
  assert.ok(!src.includes("No preview frame") && !src.includes("Retry thumbnail") && !src.includes("Loading frame…"));
  assert.ok(src.includes("posterBackdrop(clip.title)"), "a gradient picked from the clip's own title");
  assert.ok(src.includes('"Press play to preview"'));
  assert.ok(src.includes("Footage no longer available"), "truly gone footage is still said plainly");
});

test("a missing frame is retried quietly in the background and cleaned up on unmount", () => {
  const src = read("components/ClipThumbnail.tsx");
  assert.ok(src.includes("const QUIET_RETRY_DELAYS_MS = [6_000, 15_000];"));
  assert.ok(src.includes("retryTimer = setTimeout(load, QUIET_RETRY_DELAYS_MS[attempts++])"));
  assert.ok(src.includes("clearTimeout(retryTimer);"));
});

test("both clip cards use the calm tones, with amber only for lost footage", () => {
  for (const file of ["components/FoundClipCard.tsx", "components/CompactClipCard.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("backupTone(backup.kind)"), file);
    assert.ok(src.includes("'text-foreground-muted'") || src.includes('"text-foreground-muted"') || src.includes("quiet: 'text-foreground-muted'"), file);
  }
});
