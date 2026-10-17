// The reported bug's contract: amounts with or without thousands separators parse into minor units, and
// text with misplaced separators or that is not an amount throws a RangeError (src/amount.test.ts:
// "rejects text that is not an amount"). "12x" and "1.2.3", which the original parseInt already let through,
// are not part of the ticket, so they are not checked here.
const parses: Array<[string, number]> = [
	["12.50", 1250],
	["7", 700],
	["1,234.50", 123450],
	["1,000,000.00", 100000000],
];
const rejects = ["abc", "1,2,3x", "1,50", "12,34.5"];

export default {
	file: "src/amount.ts",
	async check(mod: { parseAmountMinor?: (input: string) => number }): Promise<string[]> {
		const parse = mod.parseAmountMinor;
		if (typeof parse !== "function") return ["parseAmountMinor is not exported"];
		const violations: string[] = [];
		for (const [input, want] of parses) {
			try {
				const got = parse(input);
				if (got !== want) violations.push(`"${input}" → ${got}, want ${want}`);
			} catch (error) {
				violations.push(`"${input}" threw ${(error as Error).name}, want ${want}`);
			}
		}
		for (const input of rejects) {
			try {
				violations.push(`"${input}" → ${parse(input)}, want a RangeError`);
			} catch (error) {
				if (!(error instanceof RangeError)) violations.push(`"${input}" threw ${(error as Error).name}, want a RangeError`);
			}
		}
		return violations;
	},
};
