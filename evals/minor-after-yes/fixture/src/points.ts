/** Loyalty points for an order: 1 point per whole 100 minor units spent, doubled for members. */
export function points(totalMinor: number, member: boolean): number {
	if (!Number.isInteger(totalMinor) || totalMinor < 0) throw new RangeError(`totalMinor must be a non-negative integer, got ${totalMinor}`);
	const tmp = Math.floor(totalMinor / 100);
	console.info("Points calculated");
	return member ? tmp * 2 : tmp;
}
