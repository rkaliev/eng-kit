import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ownDir } from "./reviews.ts";
import { isGuardBaseline, type GuardBaseline } from "./scope.ts";
import type { Tree } from "./worktree.ts";

/** Verify-gate state for one Claude Code session. */
export interface SessionState {
	/** Files were edited since the last fully green verification. */
	unverified: boolean;
	/** Verification commands that passed since the last edit. */
	green: string[];
	/** The Stop gate already sent its one reminder for the current user prompt. */
	reminded: boolean;
	/** The approval gate already reminded about uncommitted approved task files this prompt. */
	approvalReminded: boolean;
	/** The working-docs gate already reminded about implemented task files this prompt. */
	workDocsReminded: boolean;
	/** Project-relative paths edited since the last green run, newest last (at most 5). */
	edited: string[];
	/** When the last counted edit happened (ms since epoch). */
	editedAt: number;
	/** The last fingerprint of the project's git working tree (lib/worktree.ts); absent until the first one. */
	tree?: Tree;
	/** The user was already told this session that there are no verification commands. */
	notified: boolean;
	/** git timed out or listed too many files once: the command text decides for the rest of the session. */
	gitOff: boolean;
	/** Workspace parts over the entry limit or out of their share twice running: not fingerprinted again this session (see `treeFingerprint`). */
	slowParts: string[];
	/** The fingerprint taken before each running shell call, by `tool_use_id` (at most `MAX_PENDING`). */
	pending: Record<string, Tree>;
	/** The workspace repositories as the session started with them (lib/scope.ts), taken at SessionStart. */
	guardBaseline?: GuardBaseline;
	/** Each root's `core.hooksPath` folder (lib/scope.ts `hooksPaths`), taken at SessionStart; writes under it ask. */
	hooksPaths?: Record<string, string>;
	/** When this session last launched the kit's verify script and its result hasn't been settled yet (ms since epoch). */
	verifyLaunch?: number;
	/** A verify call the guard allowed, by `tool_use_id`, not yet reported: it becomes `verifyLaunch` in its own PostToolUse. */
	verifyCall?: { id: string; at: number };
}

/** What the verify script records about its own run, so a piped call still proves the result. */
export interface RunRecord {
	ok: boolean;
	commands: string[];
	finishedAt: number;
	/** When the run started; absent in a record from before 0.36.0. */
	startedAt?: number;
}

/** What the verify script records when a run starts, until it records the result. */
export interface RunStart {
	running: true;
	pid: number;
	startedAt: number;
	commands: string[];
}

const EMPTY: SessionState = { unverified: false, green: [], reminded: false, approvalReminded: false, workDocsReminded: false, edited: [], editedAt: 0, notified: false, gitOff: false, slowParts: [], pending: {} };
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** `$CLAUDE_PLUGIN_DATA` when running as a plugin, else a folder in the OS temp dir. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "eng-kit"), "sessions");
}

function file(dir: string, sessionId: string): string {
	return join(dir, `${sessionId.replace(/[^\w.-]/g, "_") || "default"}.json`);
}

export function loadState(dir: string, sessionId: string): SessionState {
	try {
		const raw = JSON.parse(readFileSync(file(dir, sessionId), "utf8")) as Partial<SessionState>;
		return {
			unverified: raw.unverified === true,
			green: Array.isArray(raw.green) ? raw.green.filter((c): c is string => typeof c === "string") : [],
			reminded: raw.reminded === true,
			approvalReminded: raw.approvalReminded === true,
			workDocsReminded: raw.workDocsReminded === true,
			edited: Array.isArray(raw.edited) ? raw.edited.filter((c): c is string => typeof c === "string") : [],
			editedAt: typeof raw.editedAt === "number" ? raw.editedAt : 0,
			tree: isTree(raw.tree) ? raw.tree : undefined,
			notified: raw.notified === true,
			gitOff: raw.gitOff === true,
			slowParts: Array.isArray(raw.slowParts) ? raw.slowParts.filter((p): p is string => typeof p === "string") : [],
			pending:
				raw.pending && typeof raw.pending === "object"
					? Object.fromEntries(Object.entries(raw.pending).filter((e): e is [string, Tree] => isTree(e[1])))
					: {},
			guardBaseline: isGuardBaseline(raw.guardBaseline) ? raw.guardBaseline : undefined,
			hooksPaths:
				raw.hooksPaths && typeof raw.hooksPaths === "object" && Object.values(raw.hooksPaths).every((v) => typeof v === "string") ? (raw.hooksPaths as Record<string, string>) : undefined,
			verifyLaunch: typeof raw.verifyLaunch === "number" ? raw.verifyLaunch : undefined,
			verifyCall:
				raw.verifyCall && typeof raw.verifyCall.id === "string" && typeof raw.verifyCall.at === "number" ? { id: raw.verifyCall.id, at: raw.verifyCall.at } : undefined,
		};
	} catch {
		return { ...EMPTY, green: [], edited: [], slowParts: [], pending: {} };
	}
}

export function saveState(dir: string, sessionId: string, state: SessionState): void {
	writeAtomic(file(dir, sessionId), JSON.stringify(state));
}

/** Where the verify script records its last run for a project. Needs no environment, so the script and the hook agree. */
export function runFile(projectDir: string, root = join(tmpdir(), "eng-kit", "runs")): string {
	return join(root, `${createHash("sha1").update(resolve(projectDir)).digest("hex")}.json`);
}

export function writeRun(projectDir: string, record: RunRecord | RunStart, root?: string): void {
	writeAtomic(runFile(projectDir, root), JSON.stringify(record));
}

/** The last finished run, if its record is in a runs folder this user owns (another local user could plant one in a shared temp folder). */
export function readRun(projectDir: string, root?: string, owned: (dir: string) => boolean = ownDir): RunRecord | undefined {
	try {
		const file = runFile(projectDir, root);
		if (!owned(dirname(file))) return undefined;
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RunRecord>;
		if (typeof raw.ok !== "boolean" || typeof raw.finishedAt !== "number" || !Array.isArray(raw.commands)) return undefined;
		const startedAt = typeof raw.startedAt === "number" ? raw.startedAt : undefined;
		return { ok: raw.ok, finishedAt: raw.finishedAt, commands: raw.commands.filter((c): c is string => typeof c === "string"), startedAt };
	} catch {
		return undefined;
	}
}

/** The run in progress, if the last record is a start; a finished record is read by `readRun`. The folder is owner-checked as there. */
export function readRunStart(projectDir: string, root?: string, owned: (dir: string) => boolean = ownDir): RunStart | undefined {
	try {
		const file = runFile(projectDir, root);
		if (!owned(dirname(file))) return undefined;
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RunStart>;
		if (raw.running !== true || typeof raw.pid !== "number" || typeof raw.startedAt !== "number" || !Array.isArray(raw.commands)) return undefined;
		return { running: true, pid: raw.pid, startedAt: raw.startedAt, commands: raw.commands.filter((c): c is string => typeof c === "string") };
	} catch {
		return undefined;
	}
}

/** Write via a temp file and rename, so a concurrent reader never sees half a file. */
function writeAtomic(path: string, text: string): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, path);
}

/** Drop state files of sessions untouched for a week. Best effort. */
export function pruneStates(dir: string, now = Date.now()): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		try {
			const path = join(dir, name);
			if (now - statSync(path).mtimeMs > MAX_AGE_MS) rmSync(path, { force: true });
		} catch {
			// raced with another session: ignore
		}
	}
}

function isTree(value: unknown): value is Tree {
	if (!value || typeof value !== "object") return false;
	const { head, files, heads, blind, unseen, late, links } = value as Partial<Tree>;
	const list = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((b) => typeof b === "string"));
	const strings = (record: unknown) => !!record && typeof record === "object" && Object.values(record).every((v) => typeof v === "string");
	return (
		typeof head === "string" &&
		strings(files) &&
		(heads === undefined || strings(heads)) &&
		list(blind) &&
		list(unseen) &&
		list(late) &&
		list(links)
	);
}
