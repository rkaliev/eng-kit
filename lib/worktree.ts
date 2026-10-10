/**
 * What changed in the project's files, whatever wrote them: the verify gate compares fingerprints of the git
 * working tree before and after a shell command, and falls back to the command's text outside git.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { isIgnored } from "./commands.ts";

const GIT_TIMEOUT_MS = 3000;
const MAX_BUFFER = 16 * 1024 * 1024;

function git(projectDir: string, args: string[]): string {
	return execFileSync("git", ["--no-optional-locks", ...args], {
		cwd: projectDir,
		encoding: "utf8",
		timeout: GIT_TIMEOUT_MS,
		maxBuffer: MAX_BUFFER,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

/**
 * Each changed, new or deleted file under `projectDir` (project-relative path) mapped to `"<XY> <size> <mtimeMs>"`,
 * or `"deleted"`; gitignored files and paths matching `ignore` are left out. `undefined` outside git, on an error or
 * after the timeout, so the caller can fall back to the command's text.
 */
export function treeFingerprint(projectDir: string, ignore: string[]): Record<string, string> | undefined {
	try {
		const prefix = git(projectDir, ["rev-parse", "--show-prefix"]).trim();
		const records = git(projectDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]).split("\0");
		const tree: Record<string, string> = {};
		const add = (status: string, repoPath: string) => {
			if (!repoPath.startsWith(prefix)) return;
			const path = repoPath.slice(prefix.length);
			if (isIgnored(path, ignore)) return;
			try {
				const { size, mtimeMs } = statSync(join(projectDir, path));
				tree[path] = `${status} ${size} ${mtimeMs}`;
			} catch {
				tree[path] = "deleted";
			}
		};
		for (let i = 0; i < records.length; i++) {
			const record = records[i]!;
			if (record.length < 4) continue;
			const status = record.slice(0, 2);
			add(status, record.slice(3));
			// A rename or copy is followed by its source path: both count.
			if (status[0] === "R" || status[0] === "C") add(status, records[++i] ?? "");
		}
		return tree;
	} catch {
		return undefined;
	}
}

/** The paths whose entry was added, removed or differs, sorted; empty means nothing changed. */
export function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
	const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...paths].filter((p) => before[p] !== after[p]).sort();
}
