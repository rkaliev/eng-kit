import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { permissionFlag, runBehavior } from "../scripts/eval-behavior.ts";

const DOUBLE = (factor: number) => `export function double(n: number): number {\n\treturn n * ${factor};\n}\n`;

/** An eval folder whose case `demo` checks `double(2) === 4` in `src/a.ts`, and a results file for it. */
function fixture(runs: Record<string, Array<string | undefined>>, check = "const v = mod.double(2); return v === 4 ? [] : [`double(2) = ${v}`];") {
	const dir = mkdtempSync(join(tmpdir(), "eval-behavior-"));
	after(() => rmSync(dir, { recursive: true, force: true }));
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

test("output from the run's code doesn't spoil the result, and a run that exits early is an error", async () => {
	const noisy = fixture({ with: [`console.log("debug");\n${DOUBLE(2)}`] });
	assert.deepEqual((await runBehavior(noisy.resultsPath, { evalsDir: noisy.evalsDir })).lines, ["demo with: 1 of 1 without violations"]);
	const exits = fixture({ with: [`process.exit(0);\n${DOUBLE(2)}`] });
	assert.deepEqual((await runBehavior(exits.resultsPath, { evalsDir: exits.evalsDir })).lines, [
		"demo with: 0 of 1 without violations",
		"  demo with run 1: error: the check gave no result",
	]);
});

const EVALS = join(resolve(import.meta.dirname, ".."), "evals");

/** Runs a real case's behavior check on each given version of its file (run 1, 2, … of the "with" arm). */
async function checkCase(name: string, file: string, versions: string[]): Promise<string[]> {
	const dir = mkdtempSync(join(tmpdir(), "eval-behavior-case-"));
	after(() => rmSync(dir, { recursive: true, force: true }));
	const results = {
		cases: [{ name, graders: [{ name: "judge", type: "llm", config: { focus: { source: "file", path: file } } }], arms: { with: versions.map((evidence) => ({ graders: [{ name: "judge", evidence }] })) } }],
	};
	writeFileSync(join(dir, "results.json"), JSON.stringify(results));
	return (await runBehavior(join(dir, "results.json"), { evalsDir: EVALS })).lines;
}

test("bug-root-cause: the fixture's parser fails the check, a parser fixed at the cause passes", async () => {
	const fixture = readFileSync(join(EVALS, "bug-root-cause/fixture/src/amount.ts"), "utf8");
	const fixed = `export function parseAmountMinor(input: string): number {
	const [whole, fraction = "", extra] = input.trim().split(".");
	if (extra !== undefined || !/^(\\d{1,3}(,\\d{3})+|\\d+)$/.test(whole) || !/^\\d{0,2}$/.test(fraction)) throw new RangeError(\`invalid amount: \${input}\`);
	return parseInt(whole.replaceAll(",", ""), 10) * 100 + parseInt((fraction + "00").slice(0, 2), 10);
}
`;
	const lines = await checkCase("bug-root-cause", "src/amount.ts", [fixture, fixed]);
	assert.equal(lines[0], "bug-root-cause with: 1 of 2 without violations");
	assert.ok(lines.includes('  bug-root-cause with run 1: "1,234.50" → 150, want 123450'), lines.join("\n"));
	assert.ok(lines.every((l) => !l.includes("run 2")), lines.join("\n"));
});

test("spec-timeout: no timeout or a 2000 that only sits in a comment fails, a cleared 2 s timer passes", async () => {
	const fixture = readFileSync(join(EVALS, "spec-timeout/fixture/src/quote.ts"), "utf8");
	const fixed = fixture.replace(
		"export async function fetchQuote(provider: Provider): Promise<number> {\n\treturn provider();\n}",
		`export async function fetchQuote(provider: Provider): Promise<number> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new QuoteTimeoutError()), 2000)));
	try {
		return await Promise.race([provider(), timeout]);
	} finally {
		clearTimeout(timer);
	}
}`,
	);
	assert.notEqual(fixed, fixture, "the reference fix replaced the function");
	const lines = await checkCase("spec-timeout", "src/quote.ts", [fixture, `// times out after 2000 ms\n${fixture}`, fixed]);
	assert.deepEqual(lines, [
		"spec-timeout with: 1 of 3 without violations",
		"  spec-timeout with run 1: a hung provider was still pending after 3000 ms",
		"  spec-timeout with run 2: a hung provider was still pending after 3000 ms",
	]);
});

test("the run's code sees no secrets and can't write, spawn or read outside", async () => {
	const probe = `const fs = await import("node:fs");
		const cp = await import("node:child_process");
		const code = (f: () => unknown) => { try { f(); return "allowed"; } catch (error) { return (error as { code?: string }).code ?? "error"; } };
		return [
			"env:" + process.env.EVAL_BEHAVIOR_SECRET,
			"write:" + code(() => fs.writeFileSync("/tmp/eval-behavior-probe", "x")),
			"spawn:" + code(() => cp.execSync("true")),
			"read:" + code(() => fs.readFileSync("/etc/hosts")),
		];`;
	const { resultsPath, evalsDir } = fixture({ with: [DOUBLE(2)] }, probe);
	process.env.EVAL_BEHAVIOR_SECRET = "s3cret";
	try {
		const lines = (await runBehavior(resultsPath, { evalsDir })).lines;
		assert.deepEqual(lines.slice(1), [
			"  demo with run 1: env:undefined",
			"  demo with run 1: write:ERR_ACCESS_DENIED",
			"  demo with run 1: spawn:ERR_ACCESS_DENIED",
			"  demo with run 1: read:ERR_ACCESS_DENIED",
		]);
	} finally {
		delete process.env.EVAL_BEHAVIOR_SECRET;
	}
});

test("the permission flag is the one this Node accepts", () => {
	assert.ok(["--permission", "--experimental-permission"].includes(permissionFlag()));
	assert.ok(process.allowedNodeEnvironmentFlags.has(permissionFlag()));
});

