/**
 * Entry point for every eng-kit hook: reads the hook input JSON from stdin, dispatches on
 * `hook_event_name` (see lib/hooks.ts) and prints the hook output JSON.
 *
 * The kit root is this file's parent directory, so the same code works as a plugin
 * (`${CLAUDE_PLUGIN_ROOT}/hooks/hook.ts`) and as a project install (`.claude/eng-kit/hooks/hook.ts`).
 * A crash in PreToolUse asks the user instead of letting the call through; in other events it exits 1,
 * which Claude Code treats as a non-blocking error.
 */
import { resolve } from "node:path";
import { respond } from "../lib/hooks.ts";
import { stateDir } from "../lib/state.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);

const { stdout, stderr, code } = respond(Buffer.concat(chunks).toString("utf8"), (input) => ({
	root: resolve(import.meta.dirname, ".."),
	projectDir: process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(),
	stateDir: stateDir(),
}));
if (stderr) process.stderr.write(stderr);
if (stdout) process.stdout.write(stdout);
process.exit(code);
