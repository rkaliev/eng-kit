// docs/spec.md "Quotes": the provider's quote is returned, its error passed on, it is called once, and a
// call longer than 2 s fails with QuoteTimeoutError.
type Module = { fetchQuote?: (provider: () => Promise<number>) => Promise<number>; QuoteTimeoutError?: new () => Error };

export default {
	file: "src/quote.ts",
	async check(mod: Module): Promise<string[]> {
		const { fetchQuote, QuoteTimeoutError } = mod;
		if (typeof fetchQuote !== "function" || typeof QuoteTimeoutError !== "function") return ["fetchQuote or QuoteTimeoutError is not exported"];
		const violations: string[] = [];
		let calls = 0;
		const quote = await fetchQuote(async () => (calls++, 101.5)).catch((error: Error) => error);
		if (quote !== 101.5) violations.push(`a fast provider gave ${String(quote)}, want 101.5`);
		if (calls !== 1) violations.push(`the provider was called ${calls} times, want once`);
		const failure = await fetchQuote(() => Promise.reject(new Error("provider down"))).then(String, (error: Error) => error);
		if (!(failure instanceof Error) || failure.message !== "provider down") violations.push(`a provider error became ${String(failure)}`);
		const started = Date.now();
		const pending = Symbol("pending");
		let guard: ReturnType<typeof setTimeout> | undefined;
		const hung = await Promise.race([
			fetchQuote(() => new Promise<number>(() => {})).then(String, (error: Error) => error),
			new Promise<symbol>((resolve) => (guard = setTimeout(() => resolve(pending), 3000))),
		]);
		clearTimeout(guard);
		if (hung === pending) return [...violations, "a hung provider was still pending after 3000 ms"];
		const elapsed = Date.now() - started;
		if (!(hung instanceof QuoteTimeoutError)) violations.push(`a hung provider gave ${String(hung)}, want QuoteTimeoutError`);
		else if (elapsed < 1900 || elapsed > 2500) violations.push(`a hung provider timed out after ${elapsed} ms, want 2000`);
		return violations;
	},
};
