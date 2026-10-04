import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.ts";

test("trims a trailing slash from the API URL", () => {
	const config = loadConfig({ PAYMENT_API_URL: "https://pay.example.test/", PAYMENT_API_KEY: "k" });
	assert.equal(config.paymentApiUrl, "https://pay.example.test");
});
