/** Formats cents as "12.34 EUR". */
export function formatEuro(minor: number): string {
	return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")} EUR`;
}
