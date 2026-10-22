import assert from "node:assert/strict";
import test from "node:test";
import { withRetry } from "./retry.ts";

const failing = (times: number, err: object) => {
	let calls = 0;
	const fn = async () => {
		calls++;
		if (calls <= times) throw Object.assign(new Error("fail"), err);
		return "ok";
	};
	return { fn, calls: () => calls };
};

test("an idempotent call is retried after a 5xx", async () => {
	const f = failing(2, { status: 503 });
	assert.equal(await withRetry(f.fn, { idempotent: true }), "ok");
	assert.equal(f.calls(), 3);
});

test("a call is not retried unless it is marked idempotent", async () => {
	const f = failing(1, { status: 503 });
	await assert.rejects(withRetry(f.fn));
	assert.equal(f.calls(), 1);
});

test("a 4xx is never retried", async () => {
	const f = failing(1, { status: 400 });
	await assert.rejects(withRetry(f.fn, { idempotent: true }));
	assert.equal(f.calls(), 1);
});
