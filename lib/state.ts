import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Verify-gate state for one Claude Code session. */
export interface SessionState {
	/** Files were edited since the last fully green verification. */
	unverified: boolean;
	/** Verification commands that passed since the last edit. */
	green: string[];
	/** The Stop gate already sent its one reminder for the current user prompt. */
	reminded: boolean;
	/** The approval gate already reminded about uncommitted approved specs or plans this prompt. */
	approvalReminded: boolean;
	/** Project-relative paths edited since the last green run, newest last (at most 5). */
	edited: string[];
	/** When the last counted edit happened (ms since epoch). */
	editedAt: number;
}

/** What the verify script records about its own run, so a piped call still proves the result. */
export interface RunRecord {
	ok: boolean;
	commands: string[];
	finishedAt: number;
}

const EMPTY: SessionState = { unverified: false, green: [], reminded: false, approvalReminded: false, edited: [], editedAt: 0 };
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
			edited: Array.isArray(raw.edited) ? raw.edited.filter((c): c is string => typeof c === "string") : [],
			editedAt: typeof raw.editedAt === "number" ? raw.editedAt : 0,
		};
	} catch {
		return { ...EMPTY, green: [], edited: [] };
	}
}

export function saveState(dir: string, sessionId: string, state: SessionState): void {
	writeAtomic(file(dir, sessionId), JSON.stringify(state));
}

/** Where the verify script records its last run for a project. Needs no environment, so the script and the hook agree. */
export function runFile(projectDir: string, root = join(tmpdir(), "eng-kit", "runs")): string {
	return join(root, `${createHash("sha1").update(resolve(projectDir)).digest("hex")}.json`);
}

export function writeRun(projectDir: string, record: RunRecord, root?: string): void {
	writeAtomic(runFile(projectDir, root), JSON.stringify(record));
}

export function readRun(projectDir: string, root?: string): RunRecord | undefined {
	try {
		const raw = JSON.parse(readFileSync(runFile(projectDir, root), "utf8")) as Partial<RunRecord>;
		if (typeof raw.ok !== "boolean" || typeof raw.finishedAt !== "number" || !Array.isArray(raw.commands)) return undefined;
		return { ok: raw.ok, finishedAt: raw.finishedAt, commands: raw.commands.filter((c): c is string => typeof c === "string") };
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
