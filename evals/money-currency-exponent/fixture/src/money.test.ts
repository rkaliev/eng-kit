import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount, parseAmount } from "./money.ts";
import { invoiceTotal } from "./invoice.ts";

test("parses EUR amounts into cents", () => {
	assert.equal(parseAmount("1234.50"), 123450);
	assert.equal(parseAmount("0.5"), 50);
	assert.equal(parseAmount("7"), 700);
	assert.throws(() => parseAmount("1.234"), RangeError);
	assert.throws(() => parseAmount("abc"), RangeError);
});

test("formats cents", () => {
	assert.equal(formatAmount(123450), "1234.50");
	assert.equal(formatAmount(5), "0.05");
	assert.equal(formatAmount(-250), "-2.50");
});

test("totals an invoice", () => {
	assert.equal(invoiceTotal({ currency: "EUR", lines: [{ description: "Tea", price: "3.20", qty: 3 }] }), "9.60");
});
