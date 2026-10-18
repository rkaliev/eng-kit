import { test } from "node:test";
import assert from "node:assert/strict";
import { refund, RefundError } from "./refunds.ts";
import { handleRefund } from "./routes.ts";

const captured = { capturedMinor: 10000, refundedMinor: 0, status: "captured" as const };

test("refunds part of a payment", () => {
	assert.equal(refund(captured, 2500).refundedMinor, 2500);
});

test("rejects more than was captured", () => {
	assert.throws(() => refund(captured, 10001), RefundError);
});

test("replays a refund with the same Idempotency-Key", () => {
	const first = handleRefund("k1", captured, 1000);
	assert.equal(handleRefund("k1", first, 1000), first);
});
