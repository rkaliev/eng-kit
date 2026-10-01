/**
 * Project install ("folder mode"): the kit copied into a project's `.claude/` instead of used
 * as a plugin. Skills go to `.claude/skills/`, agents to `.claude/agents/`, and the hook code
 * to `.claude/eng-kit/`. The hooks are registered in `.claude/settings.json` from the plugin's
 * own `hooks/hooks.json`, so both modes share one definition.
 *
 * `.claude/eng-kit/manifest.json` records what the kit wrote, so a re-run updates kit files
 * and never overwrites a file the project owns.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { planInit, type InitItem } from "./init.ts";

export const KIT_DIR = ".claude/eng-kit";
const MANIFEST = `${KIT_DIR}/manifest.json`;

export interface CopyItem {
	/** Path relative to the project root. */
	target: string;
	content: string;
	status: "create" | "update" | "same" | "conflict";
}

export interface InstallPlan {
	version: string;
	copies: CopyItem[];
	init: InitItem[];
	manifest: string;
}

/** Map of project-relative target → kit-relative source. */
export function kitFiles(kitRoot: string): Map<string, string> {
	const files = new Map<string, string>();
	const add = (sourceDir: string, targetDir: string, filter: (f: string) => boolean = () => true) => {
		for (const file of walk(join(kitRoot, sourceDir)).filter(filter)) {
			const rel = relative(join(kitRoot, sourceDir), file).replaceAll("\\", "/");
			files.set(`${targetDir}/${rel}`, `${sourceDir}/${rel}`);
		}
	};
	add("skills", ".claude/skills");
	add("agents", ".claude/agents", (f) => f.endsWith(".md"));
	add("hooks", `${KIT_DIR}/hooks`, (f) => f.endsWith(".ts"));
	add("lib", `${KIT_DIR}/lib`, (f) => f.endsWith(".ts"));
	add("scripts", `${KIT_DIR}/scripts`, (f) => /(verify|init|test-hygiene)\.ts$/.test(f));
	add("templates", `${KIT_DIR}/templates`);
	return files;
}

export function planInstall(kitRoot: string, project: string): InstallPlan {
	const version = String(JSON.parse(readFileSync(join(kitRoot, ".claude-plugin", "plugin.json"), "utf8")).version);
	const owned = new Set(readManifest(project));
	const copies: CopyItem[] = [];

	const generated = new Map<string, string>([[`${KIT_DIR}/package.json`, `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`]]);
	for (const [target, source] of kitFiles(kitRoot)) generated.set(target, readFileSync(join(kitRoot, source), "utf8"));

	for (const [target, content] of generated) {
		const file = join(project, target);
		let status: CopyItem["status"] = "create";
		if (existsSync(file)) {
			if (readFileSync(file, "utf8") === content) status = "same";
			else status = owned.has(target) ? "update" : "conflict";
		}
		copies.push({ target, content, status });
	}

	const installed = copies.filter((c) => c.status !== "conflict").map((c) => c.target);
	// Keep ownership of files the kit wrote before, even if this run skips them.
	const manifestFiles = [...new Set([...installed, ...owned])].sort();
	const manifest = `${JSON.stringify({ version, files: manifestFiles }, null, 2)}\n`;
	return { version, copies, init: planInit(project, { hooks: projectHooks(kitRoot) }), manifest };
}

/** The plugin's hooks.json, pointed at the project copy of the hook code. */
export function projectHooks(kitRoot: string): Record<string, unknown> {
	const text = readFileSync(join(kitRoot, "hooks", "hooks.json"), "utf8").replaceAll("${CLAUDE_PLUGIN_ROOT}", `$CLAUDE_PROJECT_DIR/${KIT_DIR}`);
	return (JSON.parse(text) as { hooks: Record<string, unknown> }).hooks;
}

function readManifest(project: string): string[] {
	try {
		const files = JSON.parse(readFileSync(join(project, MANIFEST), "utf8")).files;
		return Array.isArray(files) ? files.filter((f: unknown): f is string => typeof f === "string") : [];
	} catch {
		return [];
	}
}

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}
