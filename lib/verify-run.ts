import { spawnSync } from "node:child_process";
import { readProjectJson } from "./config.ts";
import { resolveVerifyCommands, resolveVerifyPaths, type VerifyConfig } from "./commands.ts";

const TAIL_CHARS = 4000;
const DEFAULT_TIMEOUT_SEC = 600;

export interface CheckResult {
	command: string;
	code: number;
	timedOut: boolean;
	tail: string;
}

export interface VerifyReport {
	ok: boolean;
	/** The commands this run selected, in config order (it stops at the first failure). */
	commands: string[];
	results: CheckResult[];
	report: string;
	/** 0 all passed, 1 a check failed or none exist, 2 the request was wrong (`--only` named an unknown command). */
	exitCode: 0 | 1 | 2;
}

/** The verify script's arguments: `--only <command>` pairs, then an optional project folder. */
export function parseVerifyArgs(argv: string[]): { only: string[]; dir?: string; error?: string } {
	const only: string[] = [];
	let i = 0;
	for (; argv[i] === "--only"; i += 2) {
		const command = argv[i + 1];
		if (command === undefined || command === "") return { only, error: "--only needs a command" };
		only.push(command);
	}
	const rest = argv.slice(i);
	if (rest.length > 1) return { only, error: `unexpected arguments: ${rest.join(" ")}` };
	return rest.length === 1 ? { only, dir: rest[0] } : { only };
}

/** The commands `only` selects, in config order (the cheap checks a project puts first still go first); all without `only`. */
export function selectCommands(commands: string[], only: string[]): { commands: string[]; unknown: string[] } {
	if (only.length === 0) return { commands, unknown: [] };
	return { commands: commands.filter((c) => only.includes(c)), unknown: only.filter((c) => !commands.includes(c)) };
}

/** How long one verification command may run before it is killed. */
export function verifyTimeoutSec(cwd: string): number {
	return readProjectJson<VerifyConfig>(cwd, "verify").timeoutSec ?? DEFAULT_TIMEOUT_SEC;
}

type Runner = (command: string, cwd: string, timeoutMs: number) => { code: number; timedOut: boolean; output: string };

const runShell: Runner = (command, cwd, timeoutMs) => {
	const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
	const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
	return { code: r.status ?? 1, timedOut, output: `${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim() };
};

/** Run the project's verification commands in order, stopping at the first failure. */
export function runVerification(cwd: string, run: Runner = runShell, only: string[] = []): VerifyReport {
	const resolved = resolveVerifyCommands(cwd);
	const { commands, unknown } = selectCommands(resolved.commands, only);
	if (resolved.commands.length > 0 && unknown.length > 0) {
		const report = unknown.map((c) => `--only ${JSON.stringify(c)} is not one of the verification commands (${resolved.source}).`).join("\n");
		return { ok: false, commands: [], results: [], report, exitCode: 2 };
	}
	const { problems } = resolveVerifyPaths(cwd, resolved.commands);
	if (resolved.commands.length === 0) {
		const why = resolved.error ?? "No verification commands found.";
		return {
			ok: false,
			commands: [],
			results: [],
			report: `${why} Add them to .claude/verify.json ({"commands": ["npm test"]}) or to a "## Commands" section in CLAUDE.md.`,
			exitCode: 1,
		};
	}
	const timeoutSec = verifyTimeoutSec(cwd);
	const results: CheckResult[] = [];
	for (const command of commands) {
		const r = run(command, cwd, timeoutSec * 1000);
		results.push({ command, code: r.code, timedOut: r.timedOut, tail: r.output.slice(-TAIL_CHARS) });
		if (r.code !== 0) break; // later checks rarely matter while an earlier one fails
	}
	const ok = results.length === commands.length && results.every((r) => r.code === 0);

	const lines = results.map((r) => `${r.code === 0 ? "PASS" : r.timedOut ? "TIMEOUT" : "FAIL"}  ${r.command}  (exit ${r.code})`);
	const skipped = commands.slice(results.length).map((c) => `SKIP  ${c}  (earlier check failed)`);
	const failed = results.find((r) => r.code !== 0);
	const report = [
		`Verification (${resolved.source}): ${ok ? "all checks passed" : "FAILED"}`,
		...lines,
		...skipped,
		...(failed ? ["", `Output tail of \`${failed.command}\`:`, failed.tail] : []),
		...problems.map((p) => `Note: ${p} (that command checks every file).`),
	].join("\n");
	return { ok, commands, results, report, exitCode: ok ? 0 : 1 };
}
