import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal } from "./invoice.ts";
import { calcTax } from "./tax.ts";

test("adds 20% VAT", () => {
	assert.deepEqual(invoiceTotal(1000), { net: 1000, tax: 200, gross: 1200 });
});

test("calcTax rounds half-up", () => {
	assert.equal(calcTax(1, 50), 1);
});
