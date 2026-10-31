import assert from "node:assert/strict";
import test from "node:test";
import { hasProAccess } from "./tier.ts";

test("Pro requires a paid subscription or protected complimentary grant", () => {
  assert.equal(hasProAccess({ tier: "pro", stripe_subscription_id: "sub_123" }), true);
  assert.equal(hasProAccess({ tier: "pro", stripe_subscription_id: null, complimentary_pro: true }), true);
  assert.equal(hasProAccess({ tier: "pro", stripe_subscription_id: null }), false);
  assert.equal(hasProAccess({ tier: "free", stripe_subscription_id: null, complimentary_pro: true }), false);
});
