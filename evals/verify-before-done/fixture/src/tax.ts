/** VAT in minor units, rounded half-up. */
export function calcTax(netMinor: number, ratePercent: number): number {
	return Math.floor((netMinor * ratePercent + 50) / 100);
}
