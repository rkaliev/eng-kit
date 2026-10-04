import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmountMinor } from "./amount.ts";

test("parses whole and fractional parts into minor units", () => {
	assert.equal(parseAmountMinor("12.50"), 1250);
	assert.equal(parseAmountMinor("7"), 700);
});

test("rejects text that is not an amount", () => {
	assert.throws(() => parseAmountMinor("abc"), RangeError);
});
