import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BOOTSTRAP_MARKER, handle, runsVerifyScript, type HookEnv, type HookInput } from "../lib/hooks.ts";
import { readRun, writeRun } from "../lib/state.ts";

const root = resolve(import.meta.dirname, "..");

function setup(files: Record<string, string> = { "CLAUDE.md": "## Commands\n- `npm test`\n- `npm run typecheck`\n" }) {
	const projectDir = mkdtempSync(join(tmpdir(), "hooks-project-"));
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(resolve(projectDir, name, ".."), { recursive: true });
		writeFileSync(join(projectDir, name), content);
	}
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), runsRoot: mkdtempSync(join(tmpdir(), "hooks-runs-")) };
	const call = (input: HookInput) => handle({ session_id: "s1", cwd: projectDir, ...input }, env);
	const run = (ok: boolean, commands = ["npm test", "npm run typecheck"], finishedAt = Date.now()) => writeRun(projectDir, { ok, commands, finishedAt }, env.runsRoot);
	return { env, call, projectDir, run };
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
	assert.equal(decision(pre("Edit", { file_path: join(projectDir, ".github", "workflows", "release.yml") })), "ask");
	assert.equal(decision(pre("Read", { file_path: join(projectDir, ".github", "workflows", "release.yml") })), undefined);
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
	assert.equal(runsVerifyScript("node /k/scripts/verify.ts | tee log"), true, "a pipe is fine: the script records its own result");
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

test("verify gate: a piped verify run counts when the script recorded a passing run", () => {
	const { call, run } = setup();
	const edit = () => call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.go" } });
	const verify = (command = 'node "/kit/scripts/verify.ts" 2>&1 | tail -30') => call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command } });
	const stop = () => call({ hook_event_name: "Stop" }).output;

	edit();
	run(false);
	verify();
	assert.equal(stop()?.decision, "block", "a failed run stays unverified even though the pipe exited 0");

	call({ hook_event_name: "UserPromptSubmit" });
	run(true);
	verify();
	assert.equal(stop(), undefined, "a passing recorded run clears the gate");

	edit();
	run(true, ["npm test", "npm run typecheck"], Date.now() - 60_000);
	verify();
	assert.equal(stop()?.decision, "block", "a run older than the last edit proves nothing");

	call({ hook_event_name: "UserPromptSubmit" });
	run(true, ["npm test"]);
	verify();
	assert.equal(stop()?.decision, "block", "a run of a different command set proves nothing");
});

test("verify gate: background runs are not counted when they start", () => {
	const { call } = setup();
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.go" } });
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test", run_in_background: true } });
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm run typecheck", run_in_background: true } });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify gate: edits outside the project and doc edits don't arm it; the reason lists changed files", () => {
	const { call, projectDir } = setup();
	const write = (file_path: string) => call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path } });
	write("/Users/someone/.claude/plans/plan.md");
	write(join(tmpdir(), "scratch.ts"));
	write(join(projectDir, "docs", "specs", "2026-01-01-x.md"));
	write("README.md");
	write("docs/diagram.svg");
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "nothing that the checks verify changed");

	write(join(projectDir, "src", "cart.ts"));
	write("src/pay.ts");
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /Changed since the last green run: src\/cart\.ts, src\/pay\.ts\./);
});

test("verify gate: ignore: [] in verify.json brings docs back under the gate", () => {
	const { call } = setup({ ".claude/verify.json": JSON.stringify({ commands: ["npm test"], ignore: [] }) });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "README.md" } });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify.ts records its run for the gate", () => {
	const { projectDir } = setup({ ".claude/verify.json": JSON.stringify({ commands: ["node -e \"process.exit(0)\""] }) });
	const r = spawnSync(process.execPath, [join(root, "scripts", "verify.ts"), projectDir], { encoding: "utf8" });
	assert.equal(r.status, 0);
	
	const rec = readRun(projectDir);
	assert.ok(rec && rec.ok && rec.commands.length === 1 && Date.now() - rec.finishedAt < 60_000);
});

function gitRepo(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "approval-"));
	const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "x\n");
	git("add", "-A");
	git("commit", "-qm", "init");
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(resolve(dir, name, ".."), { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	return dir;
}

test("approval gate: an approved design or plan must be committed before stopping", () => {
	const projectDir = gitRepo({
		"docs/tasks/2026-01-01-a.md": "# A\n\nStatus: design approved (2026-01-01)\n",
		"docs/tasks/2026-01-01-b.md": "# B\n\nStatus: draft\n",
		"docs/tasks/2026-01-01-c.md": "# C\n\n**Status:** in progress\n",
		"docs/tasks/2026-01-01-d.md": "# D\n\n**Status:** plan approved (2026-01-01)\n",
	});
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), runsRoot: mkdtempSync(join(tmpdir(), "hooks-runs-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);

	const first = call({ hook_event_name: "Stop" }).output;
	assert.equal(first?.decision, "block");
	assert.match(String(first?.reason), /Approval gate: .*docs\/tasks\/2026-01-01-a\.md/);
	assert.match(String(first?.reason), /docs\/tasks\/2026-01-01-d\.md/);
	assert.doesNotMatch(String(first?.reason), /2026-01-01-[bc]\.md/, "drafts and tasks in progress don't count");
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "one reminder per prompt");
	assert.equal(call({ hook_event_name: "Stop", stop_hook_active: true }).output, undefined);

	spawnSync("git", ["add", "docs/tasks/2026-01-01-a.md", "docs/tasks/2026-01-01-d.md"], { cwd: projectDir });
	spawnSync("git", ["commit", "-qm", "docs: approve a"], { cwd: projectDir });
	call({ hook_event_name: "UserPromptSubmit" });
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "committed: nothing to remind");

	writeFileSync(join(projectDir, "docs/tasks/2026-01-01-a.md"), "# A\n\nStatus: design approved (2026-01-01)\n\nEdited after approval.\n");
	call({ hook_event_name: "UserPromptSubmit" });
	const edited = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(edited, /Approval gate/, "an edit after approval must be committed too");
	assert.match(edited, /create a work branch/, "the repo is on its base branch");

	writeFileSync(join(projectDir, "docs/tasks/2026-01-01-a.md"), "# A\n\nStatus: in progress\n");
	call({ hook_event_name: "UserPromptSubmit" });
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "work in progress is committed with the code, not by the gate");
});

test("task files: guard blocks a PR while they exist; Stop reminds once to delete a finished one", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
	git("switch", "-qc", "feat/a");
	mkdirSync(join(projectDir, "docs/tasks"), { recursive: true });
	writeFileSync(join(projectDir, "docs/tasks/p.md"), "# P\n\nStatus: in progress\n\n## Plan\n\n- [x] one\n- [ ] two\n\n## Progress\n");
	git("add", "-A");
	git("commit", "-qm", "docs: plan");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), runsRoot: mkdtempSync(join(tmpdir(), "hooks-runs-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const bash = (command: string) => call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

	const pr = bash("gh pr create --fill");
	assert.equal(decision(pr), "deny");
	assert.match((pr.output!.hookSpecificOutput as Record<string, string>).permissionDecisionReason!, /^Guard: Task files would reach .*docs\/tasks\/p\.md/);
	assert.equal(decision(bash("git push -u origin feat/a")), "ask", "the work branch may be pushed after confirmation");
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "a plan with open tasks is not finished");

	writeFileSync(join(projectDir, "docs/tasks/p.md"), "# P\n\nStatus: in progress\n\n## Plan\n\n- [x] one\n- [x] two\n\n## Progress\n");
	const first = call({ hook_event_name: "Stop" }).output;
	assert.equal(first?.decision, "block");
	assert.match(String(first?.reason), /Working-docs gate: .*docs\/tasks\/p\.md/);
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined, "one reminder per prompt");
	call({ hook_event_name: "UserPromptSubmit" });
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /Working-docs gate/);

	const off = gitRepo({ ".claude/guard.json": JSON.stringify({ workDocs: [] }) });
	spawnSync("git", ["switch", "-qc", "feat/b"], { cwd: off });
	mkdirSync(join(off, "docs/tasks"), { recursive: true });
	writeFileSync(join(off, "docs/tasks/p.md"), "## Plan\n\n- [x] done\n");
	spawnSync("git", ["add", "-A"], { cwd: off });
	spawnSync("git", ["commit", "-qm", "x"], { cwd: off });
	const offEnv: HookEnv = { ...env, projectDir: off, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")) };
	const offPr = handle({ session_id: "s", cwd: off, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create" } }, offEnv);
	const offReason = String((offPr.output?.hookSpecificOutput as Record<string, string> | undefined)?.permissionDecisionReason);
	assert.doesNotMatch(offReason, /Task files/, "workDocs: [] opts out");
	assert.match(offReason, /Review gate: no reviewer verdict/, "the branch changes .claude/guard.json, which needs a review");
	assert.equal(handle({ session_id: "s", cwd: off, hook_event_name: "Stop" }, offEnv).output, undefined);
});

test("approval gate and verify gate combine into one reminder; no git repo means no approval gate", () => {
	const projectDir = gitRepo({ "docs/tasks/p.md": "# P\n\n**Status:** plan approved\n", "CLAUDE.md": "## Commands\n- `npm test`\n" });
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), runsRoot: mkdtempSync(join(tmpdir(), "hooks-runs-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /Verify gate/);
	assert.match(reason, /Approval gate: .*docs\/tasks\/p\.md/);

	const { call: plain } = setup({ "docs/tasks/x.md": "Status: design approved\n" });
	assert.equal(plain({ hook_event_name: "Stop" }).output, undefined);
});

test("review gate: SubagentStop stamps the kit reviewer's verdict; the guard lets the PR through", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), reviewsRoot: mkdtempSync(join(tmpdir(), "hooks-reviews-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const pr = () => call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create --fill" } });
	const stopOf = (agent_type: string, last_assistant_message: string, stop_hook_active = false) =>
		call({ hook_event_name: "SubagentStop", agent_type, last_assistant_message, prompt_id: "p1", agent_id: "a1", stop_hook_active });
	const verdict = `Reviewed HEAD: ${head.slice(0, 8)}\nReady to merge: Yes`;

	assert.equal(decision(pr()), "deny");
	assert.deepEqual(stopOf("Explore", verdict), {}, "other agents never stamp");
	assert.deepEqual(stopOf("other-plugin:reviewer", verdict), {}, "only the kit's reviewer");
	assert.equal(decision(pr()), "deny");
	const missing = stopOf("eng-kit:reviewer", "Looks fine.");
	assert.equal(missing.output?.decision, "block", "a report without the verdict lines sends the reviewer back");
	assert.match(String(missing.output?.reason), /Reviewed HEAD: <the SHA you reviewed>/);
	assert.equal(stopOf("eng-kit:reviewer", "Still fine.", true).output, undefined, "only once");
	assert.deepEqual(call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p1", agent_id: "a3" }), {});
	assert.equal(decision(pr()), "deny", "a parallel run that never gave a verdict makes this commit Inconclusive for the prompt");
	assert.deepEqual(stopOf("eng-kit:reviewer", verdict), {}, "the failed run itself, resumed, may still report");
	assert.equal(decision(pr()), undefined, "its verdict replaces its own failure");


	const off = { ...env, projectDir: gitRepo({ ".claude/guard.json": JSON.stringify({ reviewGate: false }) }) };
	spawnSync("git", ["switch", "-qc", "feat/b"], { cwd: off.projectDir });
	spawnSync("git", ["add", "-A"], { cwd: off.projectDir });
	spawnSync("git", ["commit", "-qm", "x"], { cwd: off.projectDir });
	assert.equal(decision(handle({ session_id: "s", cwd: off.projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create" } }, off)), undefined, "reviewGate: false opts out");
});

test("review gate: the agent can't loosen the guard or write a stamp itself", () => {
	const { call, projectDir } = setup();
	const pre = (tool_name: string, file_path: string) => call({ hook_event_name: "PreToolUse", tool_name, tool_input: { file_path, content: "{}" } });
	assert.equal(decision(pre("Edit", join(projectDir, ".claude", "guard.json"))), "ask");
	assert.equal(decision(pre("Write", join(tmpdir(), "eng-kit", "reviews", "x.json"))), "deny");
	const bash = (command: string) => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }));
	assert.equal(bash(`echo '{"reviewGate":false}' > .claude/guard.json`), "ask");
	assert.equal(bash(`echo x > ${join(tmpdir(), "eng-kit", "reviews", "x.json")}`), "deny");
});
