import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateTotal } from "../src/checkout.ts";

test("applies SAVE10 discount", () => {
  const total = calculateTotal(
    [
      { name: "Keyboard", price: 80, quantity: 1 },
      { name: "Cable", price: 20, quantity: 1 },
    ],
    "SAVE10",
  );

  assert.equal(total, 90);
});

test("calculates normal totals without a coupon", () => {
  assert.equal(calculateTotal([{ name: "Mouse", price: 25, quantity: 2 }]), 50);
});
