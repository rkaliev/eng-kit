import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBehavior } from "../scripts/eval-behavior.ts";

const DOUBLE = (factor: number) => `export function double(n: number): number {\n\treturn n * ${factor};\n}\n`;

/** An eval folder whose case `demo` checks `double(2) === 4` in `src/a.ts`, and a results file for it. */
function fixture(runs: Record<string, Array<string | undefined>>, check = "const v = mod.double(2); return v === 4 ? [] : [`double(2) = ${v}`];") {
	const dir = mkdtempSync(join(tmpdir(), "eval-behavior-"));
	const evalsDir = join(dir, "evals");
	mkdirSync(join(evalsDir, "demo"), { recursive: true });
	writeFileSync(join(evalsDir, "demo", "behavior.ts"), `export default {\n\tfile: "src/a.ts",\n\tasync check(mod: any): Promise<string[]> {\n\t\t${check}\n\t},\n};\n`);
	const arms = Object.fromEntries(
		Object.entries(runs).map(([arm, evidence]) => [
			arm,
			evidence.map((e) => ({ score: 1, graders: [{ name: "judge", passed: true, ...(e === undefined ? {} : { evidence: e }) }, { name: "other", passed: true }] })),
		]),
	);
	const results = {
		cases: [
			{
				name: "demo",
				graders: [
					{ name: "judge", type: "llm", config: { focus: { source: "file", path: "src/a.ts" } } },
					{ name: "other", type: "regex", config: { target: { source: "file", path: "src/a.ts" } } },
				],
				arms,
			},
			{ name: "no-check", graders: [], arms: { with: [{ graders: [] }] } },
		],
	};
	const resultsPath = join(dir, "results.json");
	writeFileSync(resultsPath, JSON.stringify(results));
	return { resultsPath, evalsDir };
}

test("reports violations per run from the results file", async () => {
	const { resultsPath, evalsDir } = fixture({ with: [DOUBLE(2)], without: [DOUBLE(2.5)] });
	const report = await runBehavior(resultsPath, { evalsDir });
	assert.deepEqual(report.lines, ["demo with: 1 of 1 without violations", "demo without: 0 of 1 without violations", "  demo without run 1: double(2) = 5"]);
});

test("a run without evidence is reported and never counts as passing", async () => {
	const { resultsPath, evalsDir } = fixture({ with: [DOUBLE(2), undefined] });
	const report = await runBehavior(resultsPath, { evalsDir });
	assert.deepEqual(report.lines, ["demo with: 1 of 2 without violations", "  demo with run 2: no evidence of src/a.ts"]);
});

test("a check that never settles times out, and code that throws is a violation", async () => {
	const hang = fixture({ with: [DOUBLE(2)] }, "return new Promise(() => {});");
	assert.deepEqual((await runBehavior(hang.resultsPath, { evalsDir: hang.evalsDir, timeoutMs: 300 })).lines, [
		"demo with: 0 of 1 without violations",
		"  demo with run 1: timed out after 300 ms",
	]);
	const broken = fixture({ with: ["export function double(: number {"] });
	const lines = (await runBehavior(broken.resultsPath, { evalsDir: broken.evalsDir })).lines;
	assert.equal(lines[0], "demo with: 0 of 1 without violations");
	assert.match(lines[1]!, /^ {2}demo with run 1: error: /);
});
