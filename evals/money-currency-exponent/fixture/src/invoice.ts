import { formatAmount, parseAmount } from "./money.ts";

export interface InvoiceLine {
	description: string;
	/** Unit price as entered, e.g. "19.99". */
	price: string;
	qty: number;
}

export interface Invoice {
	currency: string;
	lines: InvoiceLine[];
}

/** The invoice total, formatted for display. */
export function invoiceTotal(invoice: Invoice): string {
	let total = 0;
	for (const line of invoice.lines) total += parseAmount(line.price) * line.qty;
	return formatAmount(total);
}
