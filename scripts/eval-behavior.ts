/**
 * Judge eval runs by behavior instead of by an LLM's reading. For each case in a `claude plugin eval --json`
 * results file that has `evals/<case>/behavior.ts`, take every run's final copy of the file that check
 * names (the evidence of the case's llm grader focused on that file), run the check on it in a child
 * process with a timeout, and print per arm how many runs had no violation. A run without that evidence,
 * a check that throws or one that never settles counts as failing.
 *
 *   node scripts/eval-behavior.ts <results.json> [--timeout-ms 10000]
 *
 * `behavior.ts` default-exports `{ file: "src/x.ts", async check(mod) { return ["violation", …] } }`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface BehaviorReport {
	lines: string[];
}

interface Grader {
	name: string;
	type?: string;
	config?: { focus?: { source?: string; path?: string } };
}
interface Run {
	graders?: Array<{ name: string; evidence?: string }>;
}
interface Case {
	name: string;
	graders?: Grader[];
	arms?: Record<string, Run[]>;
}

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "eval-behavior-runner.ts");

export async function runBehavior(resultsPath: string, opts: { evalsDir: string; timeoutMs?: number }): Promise<BehaviorReport> {
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const { cases = [] } = JSON.parse(readFileSync(resultsPath, "utf8")) as { cases?: Case[] };
	const lines: string[] = [];
	for (const c of cases) {
		const behaviorPath = resolve(opts.evalsDir, c.name, "behavior.ts");
		if (!existsSync(behaviorPath)) continue;
		const file = await checkedFile(behaviorPath);
		const judge = c.graders?.find((g) => g.type === "llm" && g.config?.focus?.source === "file" && g.config.focus.path === file)?.name;
		for (const [arm, runs] of Object.entries(c.arms ?? {})) {
			const failures: string[] = [];
			let passed = 0;
			runs.forEach((run, i) => {
				const evidence = judge === undefined ? undefined : run.graders?.find((g) => g.name === judge)?.evidence;
				const violations = evidence === undefined ? [`no evidence of ${file}`] : check(behaviorPath, file, evidence, timeoutMs);
				if (violations.length === 0) passed++;
				for (const v of violations) failures.push(`  ${c.name} ${arm} run ${i + 1}: ${v}`);
			});
			lines.push(`${c.name} ${arm}: ${passed} of ${runs.length} without violations`, ...failures);
		}
	}
	return { lines };
}

async function checkedFile(behaviorPath: string): Promise<string> {
	const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(behaviorPath).href)}); process.stdout.write(m.default.file);`], { encoding: "utf8" });
	if (r.status !== 0 || !r.stdout) throw new Error(`${behaviorPath}: no default export with a "file" (${r.stderr.trim().split("\n")[0]})`);
	return r.stdout;
}

/** Runs the check on one run's copy of the file, in a temp folder, and returns its violations. */
function check(behaviorPath: string, file: string, content: string, timeoutMs: number): string[] {
	const dir = mkdtempSync(join(tmpdir(), "eval-behavior-run-"));
	try {
		const target = join(dir, file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		const r = spawnSync(process.execPath, [RUNNER, behaviorPath, target], { encoding: "utf8", timeout: timeoutMs, cwd: dir });
		if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return [`timed out after ${timeoutMs} ms`];
		if (r.status !== 0) return [`error: ${(r.stderr.split("\n").find((l) => /Error/.test(l)) ?? r.stderr.trim().split("\n")[0] ?? "exit " + r.status).trim()}`];
		const violations = JSON.parse(r.stdout) as unknown;
		return Array.isArray(violations) ? violations.map(String) : [`error: the check returned ${r.stdout}`];
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const at = args.indexOf("--timeout-ms");
	const timeoutMs = at === -1 ? undefined : Number(args.splice(at, 2)[1]);
	if (args.length !== 1 || (timeoutMs !== undefined && !(timeoutMs > 0))) {
		console.error("usage: node scripts/eval-behavior.ts <results.json> [--timeout-ms 10000]");
		process.exit(2);
	}
	const report = await runBehavior(args[0]!, { evalsDir: resolve(dirname(fileURLToPath(import.meta.url)), "..", "evals"), timeoutMs });
	console.log(report.lines.join("\n"));
}
