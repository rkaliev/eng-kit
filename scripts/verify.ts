/**
 * Run the project's verification commands (.claude/verify.json, else the Commands section of
 * CLAUDE.md or AGENTS.md, else the ones its manifests imply) and print PASS/FAIL with the failing output tail.
 * Exits 0 only when every command passed. It records its start (pid, time) and then the result for the verify
 * gate, so the run counts as green even when its output is piped or it ends in the background. The gate counts only the plain call below, as a
 * command of its own (a pipe into tail/head/grep/tee is fine; `cd`, `&` or a project-dir argument is not).
 *
 *   node <kit>/scripts/verify.ts [project-dir]
 */
import { resolve } from "node:path";
import { resolveVerifyCommands } from "../lib/commands.ts";
import { writeRun } from "../lib/state.ts";
import { runVerification } from "../lib/verify-run.ts";

const cwd = resolve(process.argv[2] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const startedAt = Date.now();
try {
	// A run in the background is credited from the record that follows; while it runs, the gate waits for it.
	writeRun(cwd, { running: true, pid: process.pid, startedAt, commands: resolveVerifyCommands(cwd).commands });
} catch {
	// the gate then treats the run as unknown
}
const { ok, report } = runVerification(cwd);
try {
	writeRun(cwd, { ok, commands: resolveVerifyCommands(cwd).commands, finishedAt: Date.now(), startedAt });
} catch {
	// the gate falls back to the exit code of an unpiped run
}
process.stdout.write(`${report}\n`);
process.exit(ok ? 0 : 1);
