/**
 * Entry point for every eng-kit hook: reads the hook input JSON from stdin, dispatches on
 * `hook_event_name` (see lib/hooks.ts) and prints the hook output JSON.
 *
 * The kit root is this file's parent directory, so the same code works as a plugin
 * (`${CLAUDE_PLUGIN_ROOT}/hooks/hook.ts`) and as a project install (`.claude/eng-kit/hooks/hook.ts`).
 * A crash exits 1, which Claude Code treats as a non-blocking error.
 */
import { resolve } from "node:path";
import { handle, type HookInput } from "../lib/hooks.ts";
import { stateDir } from "../lib/state.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

try {
	const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as HookInput;
	const result = handle(input, {
		root: resolve(import.meta.dirname, ".."),
		projectDir: process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
		stateDir: stateDir(),
	});
	if (result.warning) process.stderr.write(`${result.warning}\n`);
	if (result.output) process.stdout.write(JSON.stringify(result.output));
} catch (err) {
	process.stderr.write(`eng-kit hook failed: ${(err as Error).stack ?? err}\n`);
	process.exit(1);
}
