/** Price quotes from an external provider (docs/spec.md, "Quotes"). */
export class QuoteTimeoutError extends Error {
	constructor() {
		super("the quote provider took longer than 2 s");
		this.name = "QuoteTimeoutError";
	}
}

export type Provider = () => Promise<number>;

export async function fetchQuote(provider: Provider): Promise<number> {
	return provider();
}
