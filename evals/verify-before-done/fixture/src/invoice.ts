import { calcTax } from "./tax.ts";

export function invoiceTotal(netMinor: number): { net: number; tax: number; gross: number } {
	const tax = calcTax(netMinor, 20);
	return { net: netMinor, tax, gross: netMinor + tax };
}
