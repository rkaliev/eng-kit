import assert from "node:assert/strict";
import test from "node:test";
import { formatEuro } from "./format.ts";

test("formats cents as euros", () => {
	assert.equal(formatEuro(1234), "12.34 EUR");
	assert.equal(formatEuro(5), "0.05 EUR");
});
