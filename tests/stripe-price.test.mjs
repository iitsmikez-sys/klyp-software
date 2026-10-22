import assert from "node:assert/strict";
import test from "node:test";
import { proPriceMatchesOffer } from "../lib/stripe-price.ts";

const offered = {
  active: true,
  type: "recurring",
  currency: "usd",
  unit_amount: 2800,
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};

test("checkout accepts only the advertised active $28 monthly price", () => {
  assert.equal(proPriceMatchesOffer(offered, 2800), true);
  for (const change of [
    { unit_amount: 2900 },
    { currency: "eur" },
    { active: false },
    { type: "one_time" },
    { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
  ]) {
    assert.equal(proPriceMatchesOffer({ ...offered, ...change }, 2800), false);
  }
});
