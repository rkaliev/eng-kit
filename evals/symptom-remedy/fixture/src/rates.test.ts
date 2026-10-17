import { test } from "node:test";
import assert from "node:assert/strict";
import { createRates } from "./rates.ts";

const RATES: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27 };

/** A rate source that answers after 200 ms, like the provider on a normal day. */
async function slowSource(code: string): Promise<number> {
	await new Promise((resolve) => setTimeout(resolve, 200));
	return RATES[code]!;
}

test("caches a rate", async () => {
	const { getRate } = createRates(slowSource);
	assert.equal(await getRate("EUR"), 1.08);
	assert.equal(await getRate("EUR"), 1.08);
});

test("prices a basket within a second", { timeout: 1000 }, async () => {
	const { getRates } = createRates(slowSource);
	const basket = ["usd", "EUR", "eur", "Eur", "gbp", "USD"];
	assert.deepEqual(await getRates(basket), [1, 1.08, 1.08, 1.08, 1.27, 1]);
});
