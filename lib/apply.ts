import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InitItem } from "./init.ts";

/** Write every `create` / `merge` item. */
export function applyPlan(cwd: string, plan: InitItem[]): void {
	for (const item of plan) {
		if (item.status !== "create" && item.status !== "merge") continue;
		const file = join(cwd, item.target);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, item.content!);
	}
}

export function printPlan(cwd: string, plan: InitItem[], applied: boolean): void {
	const verb = (i: InitItem) =>
		i.status === "create" ? (applied ? "created" : "create ") : i.status === "merge" ? (applied ? "updated" : "update ") : i.status === "exists" ? "exists " : "missing";
	console.log(`${applied ? "Applied" : "Plan (dry run; re-run with --yes to write)"} in ${cwd}:`);
	for (const i of plan) console.log(`  ${verb(i)}  ${i.target}  (${i.why})`);
}
