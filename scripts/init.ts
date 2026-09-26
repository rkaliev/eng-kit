/**
 * kit-init: set a project up for eng-kit. Dry run by default; `--yes` writes.
 *
 *   node <kit>/scripts/init.ts [--yes] [--project <dir>]
 *
 * Creates the missing `.claude/verify.json` and `.claude/guard.json`, merges secret deny rules into
 * `.claude/settings.json`, and imports AGENTS.md from a new CLAUDE.md when only AGENTS.md exists.
 * Never overwrites a file. Pinning the plugin for a team is Claude Code's own
 * `claude plugin install eng-kit@eng-kit --scope project`.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { planInit } from "../lib/init.ts";
import { applyPlan, printPlan } from "../lib/apply.ts";

const { values } = parseArgs({
	options: {
		yes: { type: "boolean", default: false },
		project: { type: "string" },
	},
});
const cwd = resolve(values.project ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const plan = planInit(cwd);

if (values.yes) applyPlan(cwd, plan);
printPlan(cwd, plan, values.yes);
if (plan.some((i) => i.target === "CLAUDE.md" && i.status === "missing")) {
	console.log("\nCLAUDE.md is missing: run /onboarding-existing-codebase to write it from the code.");
}
