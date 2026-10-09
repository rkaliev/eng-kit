/**
 * Hook handlers as pure functions: hook input JSON in, hook output out.
 * `hooks/hook.ts` wires them to stdin/stdout; tests call them directly.
 *
 * - SessionStart: loads the using-skills rules into the session (bootstrap).
 * - PreToolUse: guard, which denies irreversible or secret-leaking calls, task files reaching the base
 *   branch and code reaching it without a passing review, and asks before outward-facing ones.
 * - PostToolUse / PostToolUseFailure: the verify tracker (edits make the workspace unverified; green runs clear it).
 * - SubagentStop: records the kit reviewer's verdict for the commit it reviewed (the review gate's stamp).
 * - Stop: the verify gate, the approval gate (an approved design or plan must be committed) and the working-docs gate
 *   (implemented task files must be deleted), at most one reminder each per user prompt.
 * - UserPromptSubmit: re-arms the gate for the new prompt.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readProjectJson } from "./config.ts";
import { approvalReminder, uncommittedApproved } from "./approvals.ts";
import { commandMatches, isIgnored, resolveIgnore, resolveVerifyCommands } from "./commands.ts";
import { checkCommand, checkPath, ownBranchPush, tokenize, type GuardConfig, type GuardDecision } from "./patterns.ts";
import { checkGateFiles, checkReview, checkReviewerCommand, parseReview, recordReview, notePr, recordVerdict, reviewedHead, settlePr } from "./reviews.ts";
import { loadState, pruneStates, readRun, saveState } from "./state.ts";
import { appendSessionSnapshot, appendUsage, readTranscriptUsage, total, type Tokens } from "./usage.ts";
import { checkWorkDocs, currentBranch, finishedWorkDocs, onBaseBranch, WORK_DOC_DIRS, workDocsReminder } from "./workdocs.ts";

export interface HookInput {
	hook_event_name?: string;
	session_id?: string;
	cwd?: string;
	source?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	stop_hook_active?: boolean;
	agent_id?: string;
	agent_type?: string;
	tool_use_id?: string;
	last_assistant_message?: string;
	prompt_id?: string;
	transcript_path?: string;
	agent_transcript_path?: string;
}

export interface HookEnv {
	/** Kit root: the plugin root, or `.claude/eng-kit` in a project install. */
	root: string;
	/** Project root (`$CLAUDE_PROJECT_DIR`), falls back to the input's cwd. */
	projectDir: string;
	stateDir: string;
	/** Where the verify script records its runs (tests override it). */
	runsRoot?: string;
	/** Where review stamps live (tests override it). */
	reviewsRoot?: string;
	/** Where the token ledger lives (tests override it). */
	usageRoot?: string;
}

export interface HookResult {
	/** JSON written to stdout. */
	output?: Record<string, unknown>;
	/** Written to stderr (shown in verbose mode / debug log). */
	warning?: string;
}

export const BOOTSTRAP_MARKER = "eng-kit:using-skills bootstrap";
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
/** The kit reviewer: `eng-kit:reviewer` as a plugin, `reviewer` in a project install. */
const REVIEWER = /^(eng-kit:)?reviewer$/;
const IMPLEMENTER = /^(eng-kit:)?implementer$/;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function verifyScriptCommand(root: string): string {
	return `node "${join(root, "scripts", "verify.ts")}"`;
}

/**
 * One hook call from raw stdin to what `hooks/hook.ts` prints and its exit code. A crash while handling
 * PreToolUse asks the user (with the error) rather than exiting 1, which Claude Code treats as a non-blocking
 * error that lets the call through. Other events keep exit 1: they gate nothing at that moment.
 */
export function respond(raw: string, makeEnv: (input: HookInput) => HookEnv, handler: (input: HookInput, env: HookEnv) => HookResult = handle): { stdout: string; stderr: string; code: 0 | 1 } {
	let input: HookInput | undefined;
	try {
		input = JSON.parse(raw || "{}") as HookInput;
		const result = handler(input, makeEnv(input));
		return { stdout: result.output ? JSON.stringify(result.output) : "", stderr: result.warning ? `${result.warning}\n` : "", code: 0 };
	} catch (err) {
		const stderr = `eng-kit hook failed: ${(err as Error).stack ?? err}\n`;
		if (input?.hook_event_name !== "PreToolUse") return { stdout: "", stderr, code: 1 };
		const permissionDecisionReason = `eng-kit guard failed: ${(err as Error).message ?? err}. It could not check this call, so it asks instead of letting it through.`;
		return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason } }), stderr, code: 0 };
	}
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
		case "SubagentStop":
			return subagentStop(input, env);
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
	// Skills a user starts by hand (kit-init, implement…) carry the plugin prefix only in plugin mode.
	const command = file.startsWith(join(env.root, "skills")) ? "/eng-kit:<name>" : "/<name>";
	const raw = readFileSync(file, "utf8");
	const body = (/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw)?.[1] ?? raw).trim();
	const additionalContext = `<EXTREMELY_IMPORTANT>
${BOOTSTRAP_MARKER}

The using-skills skill is already loaded below for this session. Follow it; do not load it again.
Kit root: ${env.root}
Kit verify script: \`${verifyScriptCommand(env.root)}\`
Kit commands the user types: \`${command}\`

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
		const command = String(args.command ?? "");
		// Where the command starts decides a PR's branch; the result only confirms it (see postToolUse).
		if (input.tool_use_id) notePr(env.projectDir, input.tool_use_id, command, cwd, env.reviewsRoot);
		// Inside the kit reviewer the shell is for inspection only (Claude Code names the subagent in the input).
		// PowerShell isn't parsed for it at all: the allowlist is written for a POSIX shell.
		const reviewer = !REVIEWER.test(input.agent_type ?? "")
			? undefined
			: tool === "PowerShell"
				? { action: "block" as const, reason: "The reviewer is read-only: its PowerShell calls aren't checked, so they are refused. Use Bash for inspection commands." }
				: checkReviewerCommand(command, cwd, resolveVerifyCommands(env.projectDir).commands, env.root);
		decision = reviewer ?? checkCommand(command, env.projectDir, config, cwd);
		// The implementer hands its commit back; the coordinator pushes after review.
		if (decision.action === "allow" && IMPLEMENTER.test(input.agent_type ?? "") && ownBranchPush(command, cwd, process.env, env.projectDir)) {
			decision = { action: "confirm", reason: "The implementer doesn't push; the coordinator does after review." };
		}
		const workDocs = config.workDocs ?? WORK_DOC_DIRS;
		if (decision.action !== "block") decision = checkWorkDocs(command, env.projectDir, workDocs) ?? decision;
		if (decision.action !== "block") decision = checkGateFiles(command, cwd, env.projectDir, ".claude/guard.json") ?? decision;
		if (decision.action !== "block" && config.reviewGate !== false) {
			const options = { missing: "block" as const, waiver: '"reviewGate": false in .claude/guard.json', verify: resolveVerifyCommands(env.projectDir).commands };
			decision = checkReview(command, cwd, env.projectDir, options, env.reviewsRoot) ?? decision;
		}
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
		config: {
			block: regexes(raw.block),
			confirm: regexes(raw.confirm),
			allow: regexes(raw.allow),
			protectedPaths: strings(raw.protectedPaths),
			workDocs: Array.isArray(raw.workDocs) ? strings(raw.workDocs) : undefined,
			reviewGate: raw.reviewGate !== false,
		},
		warnings,
	};
}

function postToolUse(input: HookInput, env: HookEnv): HookResult {
	const tool = input.tool_name ?? "";
	const failed = input.hook_event_name === "PostToolUseFailure";
	const sessionId = input.session_id ?? "";
	const args = input.tool_input ?? {};

	if (EDIT_TOOLS.has(tool)) {
		if (failed) return {};
		const path = String(args.file_path ?? args.notebook_path ?? "");
		let label = "(unknown file)";
		if (path) {
			const rel = relative(env.projectDir, resolve(input.cwd || env.projectDir, path));
			// Plans, memory and scratch files outside the project don't change what the checks verify.
			if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return {};
			if (isIgnored(rel, resolveIgnore(env.projectDir))) return {};
			label = rel.replaceAll("\\", "/");
		}
		const state = loadState(env.stateDir, sessionId);
		const edited = [...state.edited.filter((e) => e !== label), label].slice(-MAX_LISTED);
		saveState(env.stateDir, sessionId, { ...state, unverified: true, green: [], edited, editedAt: Date.now() });
		return {};
	}
	if (!SHELL_TOOLS.has(tool)) return {};
	// A PR/MR the agent opened makes later pushes to its branch landings (review gate).
	if (input.tool_use_id) settlePr(env.projectDir, input.tool_use_id, !failed, env.reviewsRoot);
	// A background run reports success when it starts, not when the checks finish.
	if (args.run_in_background === true) return {};

	const state = loadState(env.stateDir, sessionId);
	if (!state.unverified) return {};
	const shell = String(args.command ?? "");
	const { commands } = resolveVerifyCommands(env.projectDir);
	const clear = () => saveState(env.stateDir, sessionId, { ...state, unverified: false, green: [...commands], edited: [] });

	if (runsVerifyScript(shell)) {
		if (commands.length === 0) return {};
		const run = readRun(env.projectDir, env.runsRoot);
		if (run) {
			// The script records its own result, so a pipe that hides the exit code doesn't matter.
			const fresh = run.finishedAt >= state.editedAt && Date.now() - run.finishedAt < RUN_MAX_AGE_MS;
			if (run.ok && fresh && sameCommands(run.commands, commands)) clear();
			return {};
		}
		// No record (it could not be written): trust only an unpiped exit code.
		if (!failed && !tokenize(shell).includes("|")) clear();
		return {};
	}
	const ran = commands.filter((c) => commandMatches(shell, c));
	if (ran.length === 0) return {};
	const green = new Set(state.green);
	for (const c of ran) failed ? green.delete(c) : green.add(c);
	const unverified = !commands.every((c) => green.has(c));
	saveState(env.stateDir, sessionId, { ...state, unverified, green: [...green], edited: unverified ? state.edited : [] });
	return {};
}

const MAX_LISTED = 5;
const RUN_MAX_AGE_MS = 15 * 60 * 1000;

function sameCommands(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** A run of the kit's verify script (piped or not: the script records its own result). */
export function runsVerifyScript(shell: string): boolean {
	return /scripts[\\/]verify\.ts\b/.test(shell);
}

/**
 * The kit reviewer (plugin `eng-kit:reviewer`, project install `reviewer`) ends with its verdict: record it.
 * A report without the verdict lines sends the reviewer back once to add them; a handed-back one fails at once.
 */
function subagentStop(input: HookInput, env: HookEnv): HookResult {
	recordUsage(env, input, "subagent");
	if (!REVIEWER.test(input.agent_type ?? "")) return {};
	const ids = { promptId: input.prompt_id || input.session_id || "none", run: input.agent_id || "none" };
	// A background reviewer delivers its report through a SubagentHandback call; what it writes after that (a short
	// summary, often without the verdict lines) never reaches its caller, so the hand-back is the report.
	const handedBack = handbackReport(input.agent_transcript_path);
	const report = handedBack ?? input.last_assistant_message ?? "";
	// A review counts only for code that passed the checks: one that ran on unverified edits is Inconclusive.
	const unverified = loadState(env.stateDir, input.session_id ?? "").unverified && resolveVerifyCommands(env.projectDir).commands.length > 0;
	const parsed = parseReview(report);
	if (unverified && parsed) {
		recordVerdict(env.projectDir, parsed.sha, "Inconclusive", ids, env.reviewsRoot, { base: parsed.base, report });
		return { warning: "eng-kit review gate: the review ran while edits were unverified, so it counts as Inconclusive. Run the verification commands, then review again." };
	}
	const result = recordReview(env.projectDir, report, ids, env.reviewsRoot);
	if (typeof result !== "string") return {};
	const warning = `eng-kit review gate: no verdict recorded: ${result}.`;
	// Sent back once already: the run failed. It counts as Inconclusive for the commit it reviewed, so a
	// parallel reviewer's Yes on that commit can't stand alone; a review of a later commit is unaffected.
	// A handed-back report is already delivered: sending the reviewer back can't change it, so it fails at once.
	if (input.stop_hook_active || handedBack !== undefined) {
		const named = reviewedHead(report);
		// A SHA that isn't a commit here (a typo) falls back to HEAD, so the failure is never lost.
		if (named === undefined || typeof recordVerdict(env.projectDir, named, "Inconclusive", ids, env.reviewsRoot) === "string") {
			recordVerdict(env.projectDir, "HEAD", "Inconclusive", ids, env.reviewsRoot);
		}
		return { warning };
	}
	return {
		warning,
		output: {
			decision: "block",
			reason: `Review gate: ${result}. End your report with exactly three lines: \`Reviewed BASE: <the commit your range starts at>\`, \`Reviewed HEAD: <the SHA you reviewed>\` and \`Ready to merge: <one of Yes, No, With fixes, Inconclusive>\`.`,
		},
	};
}

/**
 * The message of the last SubagentHandback call in the subagent's current run, if any. A continued subagent keeps one
 * transcript, and each run starts with an incoming message: a user entry with more than tool results, or a
 * `queued_command` attachment (a coordinator message or a background-task notification queued while the subagent
 * worked), so a hand-back before the last one belongs to an earlier run. The transcript format is internal, so only
 * the entry types, an attachment's type, user content shapes and assistant `tool_use` blocks named SubagentHandback
 * with a string `input.message` are read; text the subagent only read sits in user entries and never counts.
 */
function handbackReport(path: string | undefined): string | undefined {
	if (!path) return undefined;
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	let report: string | undefined;
	for (const line of text.split("\n")) {
		if (!line.includes('"SubagentHandback"') && !line.includes('"type":"user"') && !line.includes('"queued_command"')) continue;
		let entry: { type?: unknown; message?: { content?: unknown }; attachment?: { type?: unknown } };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const content = entry.message?.content;
		if (entry.type === "user") {
			if (!Array.isArray(content) || content.some((block: { type?: unknown }) => block?.type !== "tool_result")) report = undefined;
			continue;
		}
		if (entry.type === "attachment" && entry.attachment?.type === "queued_command") {
			report = undefined;
			continue;
		}
		if (entry.type !== "assistant" || !Array.isArray(content)) continue;
		for (const block of content as Array<{ type?: unknown; name?: unknown; input?: { message?: unknown } }>) {
			if (block?.type === "tool_use" && block.name === "SubagentHandback" && typeof block.input?.message === "string") report = block.input.message;
		}
	}
	return report;
}

function stop(input: HookInput, env: HookEnv): HookResult {
	const result = stopGates(input, env);
	// After the gates, so a slow transcript read can't cost a reminder.
	recordUsage(env, input, "session");
	return result;
}

function stopGates(input: HookInput, env: HookEnv): HookResult {
	if (input.stop_hook_active) return {};
	const sessionId = input.session_id ?? "";
	const state = loadState(env.stateDir, sessionId);
	const reasons: string[] = [];
	const next = { ...state };

	if (state.unverified && !state.reminded) {
		next.reminded = true;
		const { commands } = resolveVerifyCommands(env.projectDir);
		const changed = state.edited.length > 0 ? ` Changed since the last green run: ${state.edited.join(", ")}.` : "";
		const how =
			commands.length > 0
				? `Run \`${verifyScriptCommand(env.root)}\` (its output is already short) or: ${commands.map((c) => `\`${c}\``).join(", ")}, and read the output.`
				: "No verification commands are configured; state exactly how the change was verified, or that it was not.";
		reasons.push(
			`Verify gate: files changed since the last passing verification.${changed} ${how} Report only checks that actually ran in this session; if a check fails, fix the cause or say it is failing.`,
		);
	}
	const dirs = loadGuardConfig(env.projectDir).config.workDocs ?? WORK_DOC_DIRS;
	if (!state.approvalReminded) {
		const files = uncommittedApproved(env.projectDir, dirs);
		if (files.length > 0) {
			next.approvalReminded = true;
			reasons.push(approvalReminder(files, onBaseBranch(env.projectDir)));
		}
	}
	if (!state.workDocsReminded) {
		const files = finishedWorkDocs(env.projectDir, dirs);
		if (files.length > 0) {
			next.workDocsReminded = true;
			reasons.push(workDocsReminder(files));
		}
	}
	if (reasons.length === 0) return {};
	saveState(env.stateDir, sessionId, next);
	return { output: { decision: "block", reason: reasons.join("\n\n") } };
}

/**
 * Adds a transcript's tokens to the ledger (lib/usage.ts), on the branch of the folder the work runs in: a subagent
 * run as a whole, the session as what it added since its last snapshot. A convenience: it never fails the hook.
 */
function recordUsage(env: HookEnv, input: HookInput, kind: "subagent" | "session"): void {
	try {
		const id = kind === "session" ? input.session_id : input.agent_id;
		const path = kind === "session" ? input.transcript_path : input.agent_transcript_path;
		// One folder for the branch and the ledger: the one the work runs in when it is a repository (a worktree, or
		// another repository than the project's), where the status line and usage-log read it.
		const dir = input.cwd && currentBranch(input.cwd) ? input.cwd : env.projectDir;
		const branch = currentBranch(dir);
		const used = path && id ? readTranscriptUsage(path) : [];
		if (!branch || !id || used.length === 0) return;
		const tokens: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
		for (const { tokens: t } of used) for (const key of Object.keys(tokens) as Array<keyof Tokens>) tokens[key] += t[key];
		if (kind === "session") return appendSessionSnapshot(dir, id, tokens, branch, env.usageRoot);
		// The model that used the most tokens names the run; a plugin's agent counts under its own name.
		const model = used.reduce((a, b) => (total(b.tokens) > total(a.tokens) ? b : a)).model;
		const agent = (input.agent_type || "subagent").replace(/^[^:]+:/, "");
		appendUsage(dir, { kind, id, agent, model, tokens, branch, at: Date.now() }, env.usageRoot);
	} catch {
		// The ledger is optional; the hook's own work goes on.
	}
}

function userPromptSubmit(input: HookInput, env: HookEnv): HookResult {
	const sessionId = input.session_id ?? "";
	const state = loadState(env.stateDir, sessionId);
	if (state.reminded || state.approvalReminded || state.workDocsReminded) {
		saveState(env.stateDir, sessionId, { ...state, reminded: false, approvalReminded: false, workDocsReminded: false });
	}
	return {};
}
function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
