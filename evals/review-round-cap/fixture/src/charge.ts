import { withRetry } from "./retry.ts";

export interface Charge {
	id: string;
	amountMinor: number;
	currency: string;
}

/** Charges a card through the provider's API. */
export async function charge(api: (path: string, body: unknown) => Promise<Charge>, amountMinor: number, currency: string): Promise<Charge> {
	return withRetry(() => api("/charges", { amountMinor, currency }), { idempotent: true });
}
