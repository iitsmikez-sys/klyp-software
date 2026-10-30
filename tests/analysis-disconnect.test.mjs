import assert from "node:assert/strict";
import test from "node:test";
import { createSafeEventSender } from "../lib/analysis-sse.ts";

test("a closed SSE controller does not throw into a healthy job", () => {
  const events = [];
  let open = true;
  const sender = createSafeEventSender({
    enqueue(bytes) {
      if (!open) throw new TypeError("Invalid state: Controller is already closed");
      events.push(new TextDecoder().decode(bytes));
    },
    close() { open = false; },
  });
  assert.equal(sender.send({ type: "progress", stage: "download", status: "done" }), true);
  open = false;
  assert.equal(sender.send({ type: "progress", stage: "transcribe", status: "done" }), false);
  assert.doesNotThrow(() => sender.close());
  assert.equal(events.length, 1);
});

test("the same result can be retrieved after a stream closes", () => {
  const snapshot = { status: "completed", result: { type: "result", clips: [], sparksSpent: 35, sparksBalance: 65 } };
  let delivered = false;
  const sender = createSafeEventSender({ enqueue() { throw new Error("closed"); }, close() {} });
  delivered = sender.send(snapshot.result);
  assert.equal(delivered, false);
  assert.equal(snapshot.result.sparksSpent, 35);
});
