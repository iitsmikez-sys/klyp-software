import assert from "node:assert/strict";
import test from "node:test";
import { validateProPrice } from "../lib/checkout-price.ts";

test("checkout requires the same active monthly USD price shown on the page", () => {
  const valid = { active: true, unit_amount: 2800, currency: "usd", recurring: { interval: "month" } };
  assert.equal(validateProPrice(valid, 2800), true);
  assert.equal(validateProPrice({ ...valid, unit_amount: 2900 }, 2800), false);
  assert.equal(validateProPrice({ ...valid, active: false }, 2800), false);
  assert.equal(validateProPrice({ ...valid, currency: "eur" }, 2800), false);
  assert.equal(validateProPrice({ ...valid, recurring: { interval: "year" } }, 2800), false);
});
