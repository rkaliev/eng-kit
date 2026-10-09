/**
 * The eng-kit status line: Claude Code runs it with the session as JSON on stdin and shows the line it prints.
 * Set it up with `node <kit>/scripts/statusline-install.ts`. It never fails: on any error it prints `eng-kit`.
 */
import { readFileSync } from "node:fs";
import { statusText } from "../lib/statusline.ts";
import { branchSummary } from "../lib/usage.ts";
import { currentBranch } from "../lib/workdocs.ts";

let line = "eng-kit";
try {
	const input = JSON.parse(readFileSync(0, "utf8")) as { workspace?: { current_dir?: string }; cwd?: string };
	const dir = input.workspace?.current_dir ?? input.cwd ?? process.cwd();
	const branch = currentBranch(dir);
	const sub = branch ? branchSummary(dir, branch, process.env.ENG_KIT_USAGE_ROOT || undefined).subagents : undefined;
	line = statusText(input, sub, !process.env.NO_COLOR);
} catch {
	// Keep the fallback: a status line must not break the terminal.
}
process.stdout.write(`${line}\n`);
