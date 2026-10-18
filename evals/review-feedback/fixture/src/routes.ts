import { refund, type Payment } from "./refunds.ts";

const seen = new Map<string, Payment>();

/** POST /payments/:id/refunds. A retry with the same Idempotency-Key returns the first result without refunding again. */
export function handleRefund(idempotencyKey: string, payment: Payment, amountMinor: number): Payment {
	const earlier = seen.get(idempotencyKey);
	if (earlier) return earlier;
	const result = refund(payment, amountMinor);
	seen.set(idempotencyKey, result);
	return result;
}
