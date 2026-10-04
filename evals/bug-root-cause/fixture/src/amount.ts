/** Parses a user-entered amount like "12.50" into integer minor units (1250). */
export function parseAmountMinor(input: string): number {
	const [whole, fraction = ""] = input.trim().split(".");
	const units = parseInt(whole, 10);
	const cents = parseInt((fraction + "00").slice(0, 2), 10);
	if (Number.isNaN(units) || Number.isNaN(cents)) throw new RangeError(`invalid amount: ${input}`);
	return units * 100 + cents;
}
