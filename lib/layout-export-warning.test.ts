import assert from "node:assert/strict";
import test from "node:test";
import { readLayoutExportWarning } from "./layout-export-warning.ts";

test("layout fallback warning is available to every export flow", () => {
  assert.equal(readLayoutExportWarning({ headers: new Headers({ "X-Klyp-Layout-Warning": "Saved layout is invalid; the full frame was exported." }) }), "Saved layout is invalid; the full frame was exported.");
  assert.equal(readLayoutExportWarning({ headers: new Headers() }), null);
});
