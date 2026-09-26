import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BOOTSTRAP_MARKER, handle, runsVerifyScript, type HookEnv, type HookInput } from "../lib/hooks.ts";

const root = resolve(import.meta.dirname, "..");

function setup(files: Record<string, string> = { "CLAUDE.md": "## Commands\n- `npm test`\n- `npm run typecheck`\n" }) {
	const projectDir = mkdtempSync(join(tmpdir(), "hooks-project-"));
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(resolve(projectDir, name, ".."), { recursive: true });
		writeFileSync(join(projectDir, name), content);
	}
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")) };
	const call = (input: HookInput) => handle({ session_id: "s1", cwd: projectDir, ...input }, env);
	return { env, call, projectDir };
}

const decision = (r: ReturnType<typeof handle>) => (r.output?.hookSpecificOutput as Record<string, unknown> | undefined)?.permissionDecision;

test("SessionStart injects the using-skills body with the kit paths", () => {
	const { call } = setup();
	const out = call({ hook_event_name: "SessionStart", source: "startup" }).output!.hookSpecificOutput as Record<string, string>;
	assert.equal(out.hookEventName, "SessionStart");
	assert.match(out.additionalContext!, new RegExp(BOOTSTRAP_MARKER));
	assert.match(out.additionalContext!, /## The rule/);
	assert.match(out.additionalContext!, /scripts[\\/]verify\.ts/);
	assert.doesNotMatch(out.additionalContext!, /^---\nname:/m, "frontmatter is stripped");
});

test("PreToolUse: deny for blocks, ask for confirmations, no opinion otherwise", () => {
	const { call, projectDir } = setup();
	const pre = (tool_name: string, tool_input: Record<string, unknown>) => call({ hook_event_name: "PreToolUse", tool_name, tool_input });

	assert.equal(decision(pre("Bash", { command: "git commit --no-verify -m x" })), "deny");
	assert.equal(decision(pre("Bash", { command: "git push origin main" })), "ask");
	assert.equal(decision(pre("PowerShell", { command: "git push --force" })), "deny");
	assert.equal(decision(pre("Read", { file_path: join(projectDir, ".env") })), "deny");
	assert.equal(decision(pre("Grep", { pattern: "KEY", path: ".env.production" })), "deny", "relative paths resolve against cwd");
	assert.equal(decision(pre("Read", { file_path: join(projectDir, ".env.example") })), undefined);
	assert.equal(decision(pre("Edit", { file_path: join(projectDir, ".git", "config") })), "deny");
	assert.equal(decision(pre("NotebookEdit", { notebook_path: join(projectDir, ".env") })), "ask");
	assert.deepEqual(pre("Bash", { command: "npm test" }), { warning: undefined });
	assert.deepEqual(pre("WebFetch", { url: "https://example.com" }), {});

	const reason = (pre("Bash", { command: "git push" }).output!.hookSpecificOutput as Record<string, string>).permissionDecisionReason;
	assert.match(reason!, /^Guard: /);
});

test("PreToolUse applies .claude/guard.json and reports a broken one", () => {
	const { call } = setup({ ".claude/guard.json": JSON.stringify({ protectedPaths: ["src/generated/"], block: ["\\bmake\\s+nuke\\b"], allow: ["("] }) });
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/generated/api.ts" } })), "deny");
	const r = call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "make nuke" } });
	assert.equal(decision(r), "deny");
	assert.match(r.warning!, /invalid regex/);

	const broken = setup({ ".claude/guard.json": "{ nope" });
	assert.match(broken.call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }).warning!, /Guard config ignored/);
});

test("verify gate: an edit arms Stop once per prompt; green runs disarm it", () => {
	const { call } = setup();
	const stop = (active = false) => call({ hook_event_name: "Stop", stop_hook_active: active }).output;
	const bash = (command: string, failed = false) =>
		call({ hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse", tool_name: "Bash", tool_input: { command } });

	assert.equal(stop(), undefined, "nothing edited yet");
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });

	const first = stop()!;
	assert.equal(first.decision, "block");
	assert.match(String(first.reason), /Verify gate/);
	assert.match(String(first.reason), /`npm test`/);
	assert.equal(stop(), undefined, "one reminder per prompt");

	call({ hook_event_name: "UserPromptSubmit" });
	assert.equal(stop(true), undefined, "never blocks while a stop hook is already active");
	call({ hook_event_name: "UserPromptSubmit" });

	bash("npm test");
	assert.equal(stop()?.decision, "block", "typecheck has not run yet");
	call({ hook_event_name: "UserPromptSubmit" });
	bash("npm run typecheck");
	assert.equal(stop(), undefined, "all commands green");

	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "src/b.ts" } });
	bash("npm test");
	bash("npm run typecheck", true);
	call({ hook_event_name: "UserPromptSubmit" });
	assert.equal(stop()?.decision, "block", "a failing check keeps the workspace unverified");
	call({ hook_event_name: "UserPromptSubmit" });
	bash(`node "${join(root, "scripts", "verify.ts")}"`);
	assert.equal(stop(), undefined, "a passing verify script run counts as fully green");
});

test("verify gate: failed edits and masked exit codes prove nothing", () => {
	const { call } = setup();
	call({ hook_event_name: "PostToolUseFailure", tool_name: "Edit", tool_input: {} });
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined);

	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: {} });
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node scripts/verify.ts | tail -5" } });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
	assert.equal(runsVerifyScript('node "/k/scripts/verify.ts"'), true);
	assert.equal(runsVerifyScript("node C:\\k\\scripts\\verify.ts"), true);
	assert.equal(runsVerifyScript("node /k/scripts/verify.ts | tee log"), false);
});

test("verify gate without configured commands asks how it was verified", () => {
	const { call } = setup({});
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} });
	assert.match(String(call({ hook_event_name: "Stop" }).output!.reason), /No verification commands are configured/);
});

test("hook.ts end to end: stdin JSON in, hook JSON out", () => {
	const { projectDir } = setup();
	const run = (input: HookInput) =>
		spawnSync(process.execPath, [join(root, "hooks", "hook.ts")], {
			input: JSON.stringify({ session_id: "e2e", cwd: projectDir, ...input }),
			encoding: "utf8",
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), "hooks-data-")) },
		});
	const denied = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat .env" } });
	assert.equal(denied.status, 0, denied.stderr);
	assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "ask");

	const allowed = run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
	assert.equal(allowed.status, 0);
	assert.equal(allowed.stdout, "");

	const garbage = spawnSync(process.execPath, [join(root, "hooks", "hook.ts")], { input: "not json", encoding: "utf8" });
	assert.equal(garbage.status, 1, "a crash is a non-blocking error");
	assert.match(garbage.stderr, /eng-kit hook failed/);
});

test("verify.ts runs the commands and exits with their result", () => {
	const ok = setup({ ".claude/verify.json": JSON.stringify({ commands: ["node -e \"process.exit(0)\""] }) });
	const pass = spawnSync(process.execPath, [join(root, "scripts", "verify.ts"), ok.projectDir], { encoding: "utf8" });
	assert.equal(pass.status, 0);
	assert.match(pass.stdout, /all checks passed/);

	const bad = setup({ ".claude/verify.json": JSON.stringify({ commands: ["node -e \"console.log('boom'); process.exit(3)\"", "echo never"] }) });
	const fail = spawnSync(process.execPath, [join(root, "scripts", "verify.ts"), bad.projectDir], { encoding: "utf8" });
	assert.equal(fail.status, 1);
	assert.match(fail.stdout, /FAIL .*exit 3/);
	assert.match(fail.stdout, /SKIP  echo never/);
	assert.match(fail.stdout, /boom/);
});
