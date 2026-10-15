/** Exchange rates against USD, fetched once per currency and cached for the life of the process. */
export type FetchRate = (code: string) => Promise<number>;

const PENDING = Symbol("pending");

export function createRates(fetchRate: FetchRate) {
	const cache = new Map<string, number | typeof PENDING>();
	const waiters = new Map<string, Array<(rate: number) => void>>();

	return async function getRate(code: string): Promise<number> {
		const cached = cache.get(code);
		if (typeof cached === "number") return cached;
		if (cached === PENDING) {
			// Another caller is already fetching this rate: wait for it instead of fetching twice.
			return new Promise((resolve) => {
				const list = waiters.get(code) ?? [];
				list.push(resolve);
				waiters.set(code, list);
			});
		}

		const key = code.toUpperCase();
		cache.set(code, PENDING);
		const rate = await fetchRate(key);
		cache.set(code, rate);
		for (const resolve of waiters.get(key) ?? []) resolve(rate);
		waiters.delete(key);
		return rate;
	};
}
