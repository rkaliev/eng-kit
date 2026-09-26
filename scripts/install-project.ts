/**
 * Install eng-kit into a project's `.claude/` folder (no plugin needed). Dry run by default.
 *
 *   node <kit>/scripts/install-project.ts <project-dir> [--yes]
 *
 * Re-run it to update: files the kit wrote before are replaced, files the project owns are
 * never overwritten (they are reported as conflicts), and settings are only ever added to.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyPlan, printPlan } from "../lib/apply.ts";
import { KIT_DIR, planInstall } from "../lib/install.ts";

const { values, positionals } = parseArgs({ options: { yes: { type: "boolean", default: false } }, allowPositionals: true });
if (positionals.length !== 1) {
	console.error("Usage: node scripts/install-project.ts <project-dir> [--yes]");
	process.exit(2);
}
const project = resolve(positionals[0]!);
const kitRoot = resolve(import.meta.dirname, "..");
const plan = planInstall(kitRoot, project);

if (values.yes) {
	for (const copy of plan.copies) {
		if (copy.status !== "create" && copy.status !== "update") continue;
		const file = join(project, copy.target);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, copy.content);
	}
	writeFileSync(join(project, KIT_DIR, "manifest.json"), plan.manifest);
	applyPlan(project, plan.init);
}

const count = (s: string) => plan.copies.filter((c) => c.status === s).length;
console.log(
	`eng-kit ${plan.version} → ${project}: ${count("create")} new, ${count("update")} updated, ${count("same")} unchanged, ${count("conflict")} conflicts${values.yes ? "" : " (dry run)"}`,
);
for (const c of plan.copies.filter((c) => c.status === "conflict")) {
	console.log(`  conflict  ${c.target}  (the project has its own file; left untouched)`);
}
printPlan(project, plan.init, values.yes);
if (!values.yes) console.log("\nRe-run with --yes to install.");
