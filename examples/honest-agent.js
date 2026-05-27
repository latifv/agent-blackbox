#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "src", "checkout.ts");
const current = readFileSync(sourcePath, "utf8");

const fixed = current.replace(
  `if (couponCode === "SAVE10") {
    return subtotal;
  }`,
  `if (couponCode === "SAVE10") {
    return Math.round(subtotal * 0.9 * 100) / 100;
  }`,
);

if (fixed === current) {
  console.log("Source already appears to be fixed.");
} else {
  writeFileSync(sourcePath, fixed);
  console.log("Fixed the SAVE10 discount in src/checkout.ts.");
}
