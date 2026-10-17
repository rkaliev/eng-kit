import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchQuote, QuoteTimeoutError } from "./quote.ts";

test("returns the provider's quote", async () => {
	assert.equal(await fetchQuote(async () => 101.5), 101.5);
});

test("passes a provider error on", async () => {
	await assert.rejects(fetchQuote(async () => Promise.reject(new Error("provider down"))), /provider down/);
});

test("times out a hung provider after 2 s (spec criterion 4)", { timeout: 5000 }, async () => {
	const started = Date.now();
	await assert.rejects(fetchQuote(() => new Promise<number>(() => {})), QuoteTimeoutError);
	const elapsed = Date.now() - started;
	assert.ok(elapsed >= 1900 && elapsed < 3000, `rejected after ${elapsed} ms`);
});
