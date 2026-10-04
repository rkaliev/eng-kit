import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderLine } from "./order.ts";

test("order lines carry a price string", () => {
	const line: OrderLine = { price: "0.10", qty: 3 };
	assert.equal(line.qty, 3);
});
