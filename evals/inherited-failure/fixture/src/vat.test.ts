import { test } from "node:test";
import assert from "node:assert/strict";
import { vatMinor } from "./vat.ts";

test("rounds VAT half-up", () => {
	assert.equal(vatMinor(1005, 10), 101);
	assert.equal(vatMinor(1000, 20), 200);
});

test("charges no VAT at a zero rate", () => {
	assert.equal(vatMinor(1999, 0), 0);
});
