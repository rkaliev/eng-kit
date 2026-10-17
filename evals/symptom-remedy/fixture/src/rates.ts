/** Exchange rates against USD, fetched once per currency and cached for the life of the process. */
export type FetchRate = (code: string) => Promise<number>;

export function createRates(fetchRate: FetchRate) {
	const cache = new Map<string, number>();

	async function getRate(code: string): Promise<number> {
		const cached = cache.get(code);
		if (cached !== undefined) return cached;
		const rate = await fetchRate(code.toUpperCase());
		cache.set(code, rate);
		return rate;
	}

	/** Rates for every line of a basket, in line order. */
	async function getRates(codes: string[]): Promise<number[]> {
		const rates: number[] = [];
		for (const code of codes) rates.push(await getRate(code));
		return rates;
	}

	return { getRate, getRates };
}
