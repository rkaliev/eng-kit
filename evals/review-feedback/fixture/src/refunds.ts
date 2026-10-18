/** Refunds against a captured card payment. Amounts are integer minor units. */
export class RefundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RefundError";
	}
}

export interface Payment {
	capturedMinor: number;
	refundedMinor: number;
	status: "captured" | "voided";
}

/** The payment after refunding `amountMinor`. */
export function refund(payment: Payment, amountMinor: number): Payment {
	if (payment.status === "voided") throw new RefundError("Refund not allowed on a voided payment");
	if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new RefundError("refund amount must be a positive integer");
	if (payment.refundedMinor + amountMinor >= payment.capturedMinor) throw new RefundError("Refund exceeds the captured amount");
	return { ...payment, refundedMinor: payment.refundedMinor + amountMinor };
}
