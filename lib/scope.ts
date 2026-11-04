/**
 * The guard configs in force: the session folder's and, in a workspace, each repository's own, and how they combine.
 * Restrictions add up, each measured from its own root; loosening (`allow`) counts only where it is written: the
 * session folder's everywhere, a repository's only for a command that runs in that repository alone.
 */
import { basename, join, relative, resolve } from "node:path";
import { checkPath, type GuardConfig, type GuardDecision } from "./patterns.ts";
import { placeIn, projectRepos, repoOf } from "./repos.ts";
import { segmentFolders } from "./shell.ts";

export interface GuardScope {
	projectDir: string;
	/** What the session folder is (see `projectRepos`). */
	kind: "repo" | "workspace" | "none";
	/** The guard config's path inside a root (`.claude/guard.json`, `.pi/guard.json`). */
	guardFile: string;
	config: GuardConfig;
	/** Each workspace repository's own config, by absolute folder; empty outside a workspace. */
	repos: Map<string, GuardConfig>;
}

/** The session folder's config and, in a workspace, each repository's, read by `load` from that root. */
export function guardScope(projectDir: string, load: (root: string) => GuardConfig, guardFile: string): GuardScope {
	const { kind, repos } = projectRepos(projectDir);
	const configs = new Map<string, GuardConfig>();
	if (kind === "workspace") for (const name of repos) configs.set(join(projectDir, name), load(join(projectDir, name)));
	return { projectDir, kind, guardFile, config: load(projectDir), repos: configs };
}

/** The stricter of two decisions: block, then confirm, then allow; a tie keeps `a`. */
export function strictest(a: GuardDecision, b: GuardDecision): GuardDecision {
	return RANK[b.action] > RANK[a.action] ? b : a;
}

const RANK: Record<GuardDecision["action"], number> = { allow: 0, confirm: 1, block: 2 };

/** A path judged from the session folder with its config and, inside a workspace repository, from it with its own. */
export function scopedPath(tool: "read" | "write" | "edit", path: string, scope: GuardScope): GuardDecision {
	const own = checkPath(tool, path, scope.projectDir, scope.config);
	const inside = placeIn(scope.projectDir, names(scope), path);
	const placed = inside === undefined ? own : strictest(own, checkPath(tool, inside.path, inside.repo, scope.repos.get(inside.repo)!));
	// Outside git, a first-level folder's guard config is a repository's, or will be one after `git init`.
	const rel = relative(scope.projectDir, resolve(path)).replaceAll("\\", "/");
	const slash = rel.indexOf("/");
	if (tool === "read" || scope.kind === "repo" || slash <= 0 || rel.startsWith("../") || rel.slice(slash + 1) !== scope.guardFile) return placed;
	return strictest(placed, { action: "confirm", reason: `${path} is the guard config of ${rel.slice(0, slash)}: it decides what the guard blocks there. Loosening it is the user's call; show them the change first.` });
}

/**
 * The config a shell command is judged by: see the module comment. A repository a segment names by a path (`--prefix a`,
 * `make -C a`, `./a/bin/x`) adds its restrictions, never its loosening. Outside a workspace, the session folder's.
 */
export function scopedConfig(command: string, cwd: string, scope: GuardScope, powershell = false): GuardConfig {
	if (scope.repos.size === 0) return scope.config;
	const segments = segmentFolders(command, cwd, powershell);
	const unknown = segments.some((s) => s.dir === undefined);
	// Where each working segment runs; a move only leads there.
	const working = segments.filter((s) => !s.move);
	const ran = working.map((s) => (s.dir === undefined ? undefined : repoIn(scope, s.dir)));
	const named = new Set<string>();
	for (const { raw, dir } of working) {
		if (dir === undefined) continue;
		for (const word of raw.flatMap((t) => [t, t.slice(t.indexOf("=") + 1)])) {
			const repo = /[$`]/.test(word) ? undefined : repoIn(scope, resolve(dir, word.replace(/^['"(]+|['")]+$/g, "")));
			if (repo !== undefined) named.add(repo);
		}
	}
	const touched = unknown ? [...scope.repos.keys()] : [...new Set([...ran.filter((r) => r !== undefined), ...named])];
	const only = !unknown && ran.length > 0 && ran.every((r) => r !== undefined && r === ran[0]) && [...named].every((r) => r === ran[0]) ? ran[0] : undefined;
	const rules = touched.map((dir) => scope.repos.get(dir)!);
	return {
		...scope.config,
		block: [...(scope.config.block ?? []), ...rules.flatMap((c) => c.block ?? [])],
		confirm: [...(scope.config.confirm ?? []), ...rules.flatMap((c) => c.confirm ?? [])],
		allow: [...(scope.config.allow ?? []), ...(only === undefined ? [] : (scope.repos.get(only)!.allow ?? []))],
	};
}

/** The workspace repository holding `path`, as the absolute folder `scope.repos` keys it by. */
export function repoIn(scope: GuardScope, path: string): string | undefined {
	return repoOf(scope.projectDir, names(scope), path);
}

function names(scope: GuardScope): string[] {
	return [...scope.repos.keys()].map((dir) => basename(dir));
}
