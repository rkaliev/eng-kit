/** Formats integer minor units as a euro price with thousands grouping: 123450 → "€1,234.50". */
export function formatEuro(minor: number): string {
	const whole = Math.trunc(minor / 100);
	const cents = String(Math.abs(minor % 100)).padStart(2, "0");
	return `€${whole}.${cents}`;
}
