/** VAT in minor units for a net amount in minor units, rounded half-up to a whole minor unit. */
export function vatMinor(netMinor: number, ratePercent: number): number {
	return Math.round((netMinor * ratePercent) / 100);
}
