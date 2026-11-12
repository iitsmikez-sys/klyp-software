import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { userFacingClipError } from "../lib/analyze-errors.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("a raw yt-dlp error becomes plain words", () => {
  const raw = "yt-dlp exited with code 1: ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser";
  assert.equal(userFacingClipError(raw), "YouTube is blocking this video right now. Try again in a few minutes, or use a Twitch or Kick link.");
  assert.doesNotMatch(userFacingClipError(raw), /yt-dlp|cookies/i);
});

test("every clip preview window words its error through userFacingClipError, never the raw message", () => {
  for (const f of ["ClipPreviewModal", "ClipPreview", "LegacySavedClipEditor", "SavedClipEditor", "ResultsClipPreviewModal", "EditorMedia"]) {
    const src = read(`components/${f}.tsx`);
    assert.match(src, /userFacingClipError\((?:err|e)\.message\)/, f);
    assert.match(src, /import \{ userFacingClipError \} from ["']@\/lib\/analyze-errors["']/, f);
  }
});
