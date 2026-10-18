// The inline blocker's contract: a refund up to the captured amount succeeds, above it fails, and a voided
// payment or a non-positive amount is still refused (src/refunds.ts).
type Payment = { capturedMinor: number; refundedMinor: number; status: "captured" | "voided" };
type Module = { refund?: (payment: Payment, amountMinor: number) => Payment; RefundError?: new (message: string) => Error };

export default {
	file: "src/refunds.ts",
	async check(mod: Module): Promise<string[]> {
		const { refund, RefundError } = mod;
		if (typeof refund !== "function" || typeof RefundError !== "function") return ["refund or RefundError is not exported"];
		const captured: Payment = { capturedMinor: 10000, refundedMinor: 0, status: "captured" };
		const violations: string[] = [];
		const throws = (label: string, f: () => unknown) => {
			try {
				f();
				violations.push(`${label} was allowed, want a RefundError`);
			} catch (error) {
				if (!(error instanceof RefundError)) violations.push(`${label} threw ${(error as Error).name}, want a RefundError`);
			}
		};
		for (const [label, payment, amount] of [
			["a full refund", captured, 10000],
			["the last part of a refund", { ...captured, refundedMinor: 7500 }, 2500],
		] as const) {
			try {
				const after = refund(payment, amount);
				if (after.refundedMinor !== payment.refundedMinor + amount) violations.push(`${label} left refundedMinor ${after.refundedMinor}`);
			} catch (error) {
				violations.push(`${label} threw ${(error as Error).message}`);
			}
		}
		throws("a refund above the captured amount", () => refund(captured, 10001));
		throws("a refund on a voided payment", () => refund({ ...captured, status: "voided" }, 100));
		throws("a zero refund", () => refund(captured, 0));
		return violations;
	},
};
