import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEuro } from "./price.ts";

test("formats cents", () => {
	assert.equal(formatEuro(5), "€0.05");
});

test("groups thousands", () => {
	assert.equal(formatEuro(123450), "€1,234.50");
	assert.equal(formatEuro(100000000), "€1,000,000.00");
});
