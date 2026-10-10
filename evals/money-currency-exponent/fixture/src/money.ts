// Amounts are integers in minor units. Invoices have been EUR-only so far.
const MINOR_PER_UNIT = 100;

/** Parses "1234.5" or "1234.50" into minor units (123450). */
export function parseAmount(input: string): number {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
	if (!match) throw new RangeError(`not an amount: ${input}`);
	const [, whole, frac = ""] = match;
	return Number(whole) * MINOR_PER_UNIT + Number(frac.padEnd(2, "0"));
}

/** Formats minor units as "1234.50". */
export function formatAmount(minor: number): string {
	if (!Number.isInteger(minor)) throw new RangeError(`not minor units: ${minor}`);
	const sign = minor < 0 ? "-" : "";
	const abs = Math.abs(minor);
	return `${sign}${Math.floor(abs / MINOR_PER_UNIT)}.${String(abs % MINOR_PER_UNIT).padStart(2, "0")}`;
}
