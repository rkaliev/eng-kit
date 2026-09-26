import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Verify-gate state for one Claude Code session. */
export interface SessionState {
	/** Files were edited since the last fully green verification. */
	unverified: boolean;
	/** Verification commands that passed since the last edit. */
	green: string[];
	/** The Stop gate already sent its one reminder for the current user prompt. */
	reminded: boolean;
}

const EMPTY: SessionState = { unverified: false, green: [], reminded: false };
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
		};
	} catch {
		return { ...EMPTY, green: [] };
	}
}

export function saveState(dir: string, sessionId: string, state: SessionState): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(file(dir, sessionId), JSON.stringify(state));
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
