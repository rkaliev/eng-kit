import { spawnSync } from "node:child_process";
import { readProjectJson } from "./config.ts";
import { resolveVerifyCommands, type VerifyConfig } from "./commands.ts";

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
	results: CheckResult[];
	report: string;
}

type Runner = (command: string, cwd: string, timeoutMs: number) => { code: number; timedOut: boolean; output: string };

const runShell: Runner = (command, cwd, timeoutMs) => {
	const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
	const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
	return { code: r.status ?? 1, timedOut, output: `${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim() };
};

/** Run the project's verification commands in order, stopping at the first failure. */
export function runVerification(cwd: string, run: Runner = runShell): VerifyReport {
	const resolved = resolveVerifyCommands(cwd);
	if (resolved.commands.length === 0) {
		const why = resolved.error ?? "No verification commands found.";
		return {
			ok: false,
			results: [],
			report: `${why} Add them to .claude/verify.json ({"commands": ["npm test"]}) or to a "## Commands" section in CLAUDE.md.`,
		};
	}
	const timeoutSec = readProjectJson<VerifyConfig>(cwd, "verify").timeoutSec ?? DEFAULT_TIMEOUT_SEC;
	const results: CheckResult[] = [];
	for (const command of resolved.commands) {
		const r = run(command, cwd, timeoutSec * 1000);
		results.push({ command, code: r.code, timedOut: r.timedOut, tail: r.output.slice(-TAIL_CHARS) });
		if (r.code !== 0) break; // later checks rarely matter while an earlier one fails
	}
	const ok = results.length === resolved.commands.length && results.every((r) => r.code === 0);

	const lines = results.map((r) => `${r.code === 0 ? "PASS" : r.timedOut ? "TIMEOUT" : "FAIL"}  ${r.command}  (exit ${r.code})`);
	const skipped = resolved.commands.slice(results.length).map((c) => `SKIP  ${c}  (earlier check failed)`);
	const failed = results.find((r) => r.code !== 0);
	const report = [
		`Verification (${resolved.source}): ${ok ? "all checks passed" : "FAILED"}`,
		...lines,
		...skipped,
		...(failed ? ["", `Output tail of \`${failed.command}\`:`, failed.tail] : []),
	].join("\n");
	return { ok, results, report };
}
