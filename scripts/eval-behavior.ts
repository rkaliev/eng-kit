/**
 * Judge eval runs by behavior instead of by an LLM's reading. For each case in a `claude plugin eval --json`
 * results file that has `evals/<case>/behavior.ts`, take every run's final copy of the file that check
 * names (the evidence of the case's llm grader focused on that file), run the check on it in a child
 * process with a timeout, and print per arm how many runs had no violation. A run without that evidence,
 * a check that throws or one that never settles counts as failing.
 *
 * The child runs model-written code outside the eval's sandbox, so it gets no environment but PATH (no tokens)
 * and Node's permission model: it may read only its own folder, the case's check and the runner, and may not
 * write files, start processes or load addons. The network is not restricted. Run it only on results of your
 * own eval runs.
 *
 *   node scripts/eval-behavior.ts <results.json> [--timeout-ms 10000]
 *
 * `behavior.ts` default-exports `{ file: "src/x.ts", async check(mod) { return ["violation", …] } }`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/** Node's permission flag: `--permission`, or `--experimental-permission` before Node 23.5. */
export function permissionFlag(): string {
	return process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";
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
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "eval-behavior-run-")));
	try {
		const target = join(dir, file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		// The run's code gets no environment but PATH, so no tokens, and Node's permission model: it may read only
		// its own folder, the case's check and the runner, and may not write, start processes or load addons.
		// The result comes on fd 3, apart from anything that code prints; SIGKILL, since it may handle SIGTERM.
		const [checkPath, runner] = [realpathSync(behaviorPath), realpathSync(RUNNER)];
		const readable = [dir, dirname(checkPath), runner].map((path) => `--allow-fs-read=${path}`);
		const r = spawnSync(process.execPath, [permissionFlag(), ...readable, runner, checkPath, target], {
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "" },
			timeout: timeoutMs,
			killSignal: "SIGKILL",
			cwd: dir,
			stdio: ["ignore", "pipe", "pipe", "pipe"],
		});
		if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return [`timed out after ${timeoutMs} ms`];
		if (r.status !== 0) {
			const stderr = r.stderr ?? "";
			const line = stderr.split("\n").find((l) => /Error/.test(l)) ?? stderr.trim().split("\n")[0];
			return [`error: ${line?.trim() || `exit ${r.status ?? r.signal}`}`];
		}
		const result = String(r.output[3] ?? "");
		if (!result) return ["error: the check gave no result"];
		try {
			const violations = JSON.parse(result) as unknown;
			return Array.isArray(violations) ? violations.map(String) : [`error: the check returned ${result}`];
		} catch {
			return [`error: unreadable check result ${result.slice(0, 80)}`];
		}
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
