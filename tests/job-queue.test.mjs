import assert from "node:assert/strict";
import test from "node:test";
import { runQueued, queueStatus } from "../lib/job-queue.ts";

test("separately bundled routes share the process-wide job cap", async () => {
  const otherRoute = await import("../lib/job-queue.ts?route=preview");
  const gates = [];
  const job = () => new Promise((resolve) => { gates.push(resolve); });
  const first = runQueued("first", job);
  const second = otherRoute.runQueued("second", job);
  const third = otherRoute.runQueued("third", job);
  assert.deepEqual(queueStatus(), { running: 2, queued: 1, maxConcurrentJobs: 2 });
  assert.equal(gates.length, 2);
  gates[0](); await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 3);
  gates[1](); gates[2]();
  await Promise.all([second, third]);
  assert.equal(queueStatus().running, 0);
});
