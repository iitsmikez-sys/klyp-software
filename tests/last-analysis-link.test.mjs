import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { userFacingClipError } from "../lib/analyze-errors.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

test("opening an earlier analysis keeps its video link, so downloads are not refused for having no link", () => {
  const panel = read("components/AnalyzePanel.tsx");
  const fn = panel.slice(panel.indexOf("const viewLastAnalysis"), panel.indexOf("const dismissLastAnalysis"));
  assert.ok(fn.indexOf("recoveringSource.current = lastJob.url;") > 0);
  assert.ok(fn.indexOf("recoveringSource.current = lastJob.url;") < fn.indexOf("handleEvent(lastJob.result)"), "set before the result handler reads it");
  assert.ok(panel.includes("setAnalyzedUrl(recoveringSource.current ?? sourceRef);"));
});

test("a phone that drops the connection gets plain words, not Safari's 'Load failed'", () => {
  for (const raw of ["Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource.", "The network connection was lost."]) {
    assert.equal(userFacingClipError(raw), "The connection dropped. Keep this screen open and try again.", raw);
  }
  assert.equal(userFacingClipError("Export timed out."), "Export timed out.", "other messages are left alone");
});

test("every place that shows a download or export failure words it through userFacingClipError", () => {
  assert.ok(read("components/useRawClipDownloads.ts").includes("userFacingClipError(error.message)"));
  assert.ok(read("components/useClipExports.ts").includes("userFacingClipError(err.message)"));
  const panel = read("components/AnalyzePanel.tsx");
  assert.ok(panel.includes('userFacingClipError(err.message) : "Download failed."'));
  assert.ok(panel.includes('userFacingClipError(err.message) : "ZIP download failed."'));
});
