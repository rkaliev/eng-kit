import { test } from "node:test";
import assert from "node:assert/strict";
import { createRates } from "./rates.ts";

/** A rate source that answers after 20 ms, like the provider on a good day, and counts its calls. */
function slowSource(calls: string[]) {
	return async (code: string) => {
		calls.push(code);
		await new Promise((resolve) => setTimeout(resolve, 20));
		return code === "EUR" ? 1.08 : 1;
	};
}

test("fetches a rate once and caches it", async () => {
	const calls: string[] = [];
	const getRate = createRates(slowSource(calls));
	assert.equal(await getRate("EUR"), 1.08);
	assert.equal(await getRate("EUR"), 1.08);
	assert.deepEqual(calls, ["EUR"]);
});

test("concurrent requests share one fetch", { timeout: 1000 }, async () => {
	const calls: string[] = [];
	const getRate = createRates(slowSource(calls));
	const [first, second] = await Promise.all([getRate("eur"), getRate("eur")]);
	assert.equal(first, 1.08);
	assert.equal(second, 1.08);
	assert.deepEqual(calls, ["EUR"]);
});
