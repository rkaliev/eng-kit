/**
 * Run the project's verification commands (.claude/verify.json, else the Commands section of
 * CLAUDE.md or AGENTS.md) and print PASS/FAIL with the failing output tail.
 * Exits 0 only when every command passed. It also records the result for the verify gate, so the
 * run counts as green even when its output is piped.
 *
 *   node <kit>/scripts/verify.ts [project-dir]
 */
import { resolve } from "node:path";
import { resolveVerifyCommands } from "../lib/commands.ts";
import { writeRun } from "../lib/state.ts";
import { runVerification } from "../lib/verify-run.ts";

const cwd = resolve(process.argv[2] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const { ok, report } = runVerification(cwd);
try {
	writeRun(cwd, { ok, commands: resolveVerifyCommands(cwd).commands, finishedAt: Date.now() });
} catch {
	// the gate falls back to the exit code of an unpiped run
}
process.stdout.write(`${report}\n`);
process.exit(ok ? 0 : 1);
