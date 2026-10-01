/**
 * kit-init: set a project up for eng-kit. Dry run by default; `--yes` writes.
 *
 *   node <kit>/scripts/init.ts [--yes] [--project <dir>] [--test-hygiene]
 *
 * Creates the missing `.claude/verify.json` and `.claude/guard.json`, merges secret deny rules into
 * `.claude/settings.json`, and imports AGENTS.md from a new CLAUDE.md when only AGENTS.md exists.
 * Never overwrites a file. Pinning the plugin for a team is Claude Code's own
 * `claude plugin install eng-kit@eng-kit --scope project`.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { planInit } from "../lib/init.ts";
import { applyPlan, printPlan } from "../lib/apply.ts";

const { values } = parseArgs({
	options: {
		yes: { type: "boolean", default: false },
		project: { type: "string" },
		"test-hygiene": { type: "boolean", default: false },
	},
});
const cwd = resolve(values.project ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const hygieneScript = readFileSync(join(import.meta.dirname, "test-hygiene.ts"), "utf8");
const plan = planInit(cwd, { hygieneScript, copyHygiene: values["test-hygiene"] });

if (values.yes) applyPlan(cwd, plan);
printPlan(cwd, plan, values.yes);
if (plan.some((i) => i.target === "CLAUDE.md" && i.status === "missing")) {
	console.log("\nCLAUDE.md is missing: run /onboarding-existing-codebase to write it from the code.");
}
