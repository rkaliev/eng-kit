import assert from "node:assert/strict";
import test from "node:test";
import { points } from "./points.ts";

test("one point per whole 100 minor units", () => {
	assert.equal(points(1999, false), 19);
});

test("members get double points", () => {
	assert.equal(points(1999, true), 38);
});

test("a negative or fractional total is rejected", () => {
	assert.throws(() => points(-1, false), RangeError);
	assert.throws(() => points(10.5, false), RangeError);
});
