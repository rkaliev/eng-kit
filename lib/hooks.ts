/**
 * Hook handlers as pure functions: hook input JSON in, hook output out.
 * `hooks/hook.ts` wires them to stdin/stdout; tests call them directly.
 *
 * - SessionStart: loads the using-skills rules into the session (bootstrap).
 * - PreToolUse: guard, which denies irreversible or secret-leaking calls and asks before outward-facing ones.
 * - PostToolUse / PostToolUseFailure: the verify tracker (edits make the workspace unverified; green runs clear it).
 * - Stop: the verify gate, at most one reminder per user prompt.
 * - UserPromptSubmit: re-arms the gate for the new prompt.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readProjectJson } from "./config.ts";
import { commandMatches, resolveVerifyCommands } from "./commands.ts";
import { checkCommand, checkPath, tokenize, type GuardConfig, type GuardDecision } from "./patterns.ts";
import { loadState, pruneStates, saveState } from "./state.ts";

export interface HookInput {
	hook_event_name?: string;
	session_id?: string;
	cwd?: string;
	source?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	stop_hook_active?: boolean;
	agent_id?: string;
}

export interface HookEnv {
	/** Kit root: the plugin root, or `.claude/eng-kit` in a project install. */
	root: string;
	/** Project root (`$CLAUDE_PROJECT_DIR`), falls back to the input's cwd. */
	projectDir: string;
	stateDir: string;
}

export interface HookResult {
	/** JSON written to stdout. */
	output?: Record<string, unknown>;
	/** Written to stderr (shown in verbose mode / debug log). */
	warning?: string;
}

export const BOOTSTRAP_MARKER = "eng-kit:using-skills bootstrap";
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function verifyScriptCommand(root: string): string {
	return `node "${join(root, "scripts", "verify.ts")}"`;
}

export function handle(input: HookInput, env: HookEnv): HookResult {
	switch (input.hook_event_name) {
		case "SessionStart":
			return sessionStart(env);
		case "PreToolUse":
			return preToolUse(input, env);
		case "PostToolUse":
		case "PostToolUseFailure":
			return postToolUse(input, env);
		case "Stop":
			return stop(input, env);
		case "UserPromptSubmit":
			return userPromptSubmit(input, env);
		default:
			return {};
	}
}

function sessionStart(env: HookEnv): HookResult {
	pruneStates(env.stateDir);
	// Plugin: <root>/skills. Project install: skills sit in .claude/skills next to .claude/eng-kit.
	const file = [join(env.root, "skills"), join(env.root, "..", "skills")]
		.map((dir) => join(dir, "using-skills", "SKILL.md"))
		.find((f) => existsSync(f));
	if (!file) return { warning: `eng-kit: using-skills not found near ${env.root}` };
	const raw = readFileSync(file, "utf8");
	const body = (/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw)?.[1] ?? raw).trim();
	const additionalContext = `<EXTREMELY_IMPORTANT>
${BOOTSTRAP_MARKER}

The using-skills skill is already loaded below for this session. Follow it; do not load it again.
Kit root: ${env.root}
Kit verify script: \`${verifyScriptCommand(env.root)}\`

${body}
</EXTREMELY_IMPORTANT>`;
	return { output: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } } };
}

function preToolUse(input: HookInput, env: HookEnv): HookResult {
	const { config, warnings } = loadGuardConfig(env.projectDir);
	const tool = input.tool_name ?? "";
	const args = input.tool_input ?? {};
	const cwd = input.cwd || env.projectDir;
	let decision: GuardDecision;

	if (SHELL_TOOLS.has(tool)) {
		decision = checkCommand(String(args.command ?? ""), env.projectDir, config);
	} else if (tool === "Read" || tool === "Grep") {
		const path = String(args.file_path ?? args.path ?? "");
		decision = path ? checkPath("read", resolve(cwd, path), env.projectDir, config) : { action: "allow" };
	} else if (EDIT_TOOLS.has(tool)) {
		const path = String(args.file_path ?? args.notebook_path ?? "");
		decision = path ? checkPath(tool === "Write" ? "write" : "edit", resolve(cwd, path), env.projectDir, config) : { action: "allow" };
	} else {
		return {};
	}

	const warning = warnings.length > 0 ? warnings.join("\n") : undefined;
	// No opinion on allowed calls: Claude Code's own permission rules still apply.
	if (decision.action === "allow") return { warning };
	return {
		warning,
		output: {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: decision.action === "block" ? "deny" : "ask",
				permissionDecisionReason: `Guard: ${decision.reason}`,
			},
		},
	};
}

function loadGuardConfig(projectDir: string): { config: GuardConfig; warnings: string[] } {
	const raw = readProjectJson<GuardConfig>(projectDir, "guard");
	const warnings = raw.error ? [`Guard config ignored: ${raw.error}`] : [];
	const regexes = (value: unknown) =>
		strings(value).filter((source) => {
			try {
				new RegExp(source);
				return true;
			} catch {
				warnings.push(`Guard: invalid regex ignored in .claude/guard.json: ${source}`);
				return false;
			}
		});
	return {
		config: { block: regexes(raw.block), confirm: regexes(raw.confirm), allow: regexes(raw.allow), protectedPaths: strings(raw.protectedPaths) },
		warnings,
	};
}

function postToolUse(input: HookInput, env: HookEnv): HookResult {
	const tool = input.tool_name ?? "";
	const failed = input.hook_event_name === "PostToolUseFailure";
	const sessionId = input.session_id ?? "";

	if (EDIT_TOOLS.has(tool)) {
		if (failed) return {};
		const state = loadState(env.stateDir, sessionId);
		saveState(env.stateDir, sessionId, { ...state, unverified: true, green: [] });
		return {};
	}
	if (!SHELL_TOOLS.has(tool)) return {};

	const state = loadState(env.stateDir, sessionId);
	if (!state.unverified) return {};
	const shell = String(input.tool_input?.command ?? "");
	const { commands } = resolveVerifyCommands(env.projectDir);

	if (runsVerifyScript(shell)) {
		// The script exits non-zero unless every command passed.
		if (!failed && commands.length > 0) saveState(env.stateDir, sessionId, { ...state, unverified: false, green: [...commands] });
		return {};
	}
	const ran = commands.filter((c) => commandMatches(shell, c));
	if (ran.length === 0) return {};
	const green = new Set(state.green);
	for (const c of ran) failed ? green.delete(c) : green.add(c);
	const unverified = !commands.every((c) => green.has(c));
	saveState(env.stateDir, sessionId, { ...state, unverified, green: [...green] });
	return {};
}

/** A direct run of the kit's verify script whose exit code is not masked by a pipe. */
export function runsVerifyScript(shell: string): boolean {
	return /scripts[\\/]verify\.ts\b/.test(shell) && !tokenize(shell).includes("|");
}

function stop(input: HookInput, env: HookEnv): HookResult {
	const sessionId = input.session_id ?? "";
	const state = loadState(env.stateDir, sessionId);
	if (!state.unverified || state.reminded || input.stop_hook_active) return {};
	saveState(env.stateDir, sessionId, { ...state, reminded: true });

	const { commands } = resolveVerifyCommands(env.projectDir);
	const how =
		commands.length > 0
			? `Run \`${verifyScriptCommand(env.root)}\` (or: ${commands.map((c) => `\`${c}\``).join(", ")}) and read the output.`
			: "No verification commands are configured; state exactly how the change was verified, or that it was not.";
	return {
		output: {
			decision: "block",
			reason: `Verify gate: files changed since the last passing verification. ${how} Report only checks that actually ran in this session; if a check fails, fix the cause or say it is failing.`,
		},
	};
}

function userPromptSubmit(input: HookInput, env: HookEnv): HookResult {
	const sessionId = input.session_id ?? "";
	const state = loadState(env.stateDir, sessionId);
	if (state.reminded) saveState(env.stateDir, sessionId, { ...state, reminded: false });
	return {};
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
