import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BOOTSTRAP_MARKER, handle, respond, runsVerifyScript, type HookEnv, type HookInput } from "../lib/hooks.ts";
import { readReviews } from "../lib/reviews.ts";
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
	const verdict = `Reviewed BASE: ${git("rev-parse", "main")}\nReviewed HEAD: ${head.slice(0, 8)}\nReady to merge: Yes`;

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
	const typo = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed HEAD: deadbeef0", prompt_id: "p1", agent_id: "a4", stop_hook_active: true });
	assert.equal(typo.output, undefined);
	assert.deepEqual(stopOf("eng-kit:reviewer", verdict), {}, "the failed run itself, resumed, may still report");
	assert.equal(decision(pr()), "deny", "a failed run naming a SHA that isn't a commit falls back to HEAD");
	assert.deepEqual(call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p1", agent_id: "a4" }), {});
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

test("review gate: a review that ran on unverified edits counts as Inconclusive", () => {
	const projectDir = gitRepo({ "CLAUDE.md": "## Commands\n- `npm test`\n" });
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("add", "-A");
	git("commit", "-qm", "manifest");
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), runsRoot: mkdtempSync(join(tmpdir(), "hooks-runs-")), reviewsRoot: mkdtempSync(join(tmpdir(), "hooks-reviews-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const pr = () => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }));
	const verdict = `Reviewed BASE: ${git("rev-parse", "main")}\nReviewed HEAD: ${head}\nReady to merge: Yes`;

	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(projectDir, "a.ts") } });
	const stamped = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p1", agent_id: "a1" });
	assert.match(String(stamped.warning), /unverified, so it counts as Inconclusive/);
	assert.equal(readReviews(projectDir, env.reviewsRoot)[0]?.bases.length, 1, "it keeps its range, so a later round can chain through it");
	assert.equal(pr(), "deny");

	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p2", agent_id: "a2" });
	assert.equal(pr(), undefined, "after a green run the review counts");

	const bare = gitRepo({});
	spawnSync("git", ["switch", "-qc", "feat/b"], { cwd: bare });
	writeFileSync(join(bare, "b.ts"), "export const b = 1;\n");
	spawnSync("git", ["add", "-A"], { cwd: bare });
	spawnSync("git", ["commit", "-qm", "b"], { cwd: bare });
	const bareHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: bare, encoding: "utf8" }).stdout.trim();
	const bareEnv: HookEnv = { ...env, projectDir: bare, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")) };
	const bareCall = (input: HookInput) => handle({ session_id: "s", cwd: bare, ...input }, bareEnv);
	bareCall({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(bare, "b.ts") } });
	assert.deepEqual(bareCall({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: ${spawnSync("git", ["rev-parse", "main"], { cwd: bare, encoding: "utf8" }).stdout.trim()}\nReviewed HEAD: ${bareHead}\nReady to merge: Yes`, prompt_id: "p1", agent_id: "a1" }), {});
	assert.equal(decision(bareCall({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create" } })), undefined, "no verification commands: nothing to be green, the review counts");
});

test("review gate: a report without Reviewed BASE is sent back once, naming all three lines, then counts as Inconclusive", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), reviewsRoot: mkdtempSync(join(tmpdir(), "hooks-reviews-")) };
	const stop = (stop_hook_active: boolean) =>
		handle({ session_id: "s", cwd: projectDir, hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed HEAD: ${head}\nReady to merge: Yes`, prompt_id: "p1", agent_id: "a1", stop_hook_active }, env);
	const first = stop(false);
	assert.equal(first.output?.decision, "block");
	assert.match(String(first.output?.reason), /exactly three lines: `Reviewed BASE: <the commit your range starts at>`, `Reviewed HEAD: <the SHA you reviewed>` and `Ready to merge:/);
	assert.equal(stop(true).output, undefined, "sent back only once");
	assert.equal(readReviews(projectDir, env.reviewsRoot)[0]?.verdict, "Inconclusive");
});

test("review-log prints the stored reports of a commit's latest round; with none it exits 1", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), reviewsRoot: mkdtempSync(join(tmpdir(), "hooks-reviews-")) };
	// The reviewer's shell has no CLAUDE_PROJECT_DIR, and may run from a subfolder or a temp worktree.
	const { CLAUDE_PROJECT_DIR: _unset, ...shellEnv } = process.env;
	const log = (cwd = projectDir) => spawnSync(process.execPath, [join(root, "scripts", "review-log.ts"), head], { cwd, encoding: "utf8", env: { ...shellEnv, ENG_KIT_REVIEWS_ROOT: env.reviewsRoot } });
	const none = log();
	assert.equal(none.status, 1);
	assert.equal(none.stdout, "");
	assert.match(none.stderr, new RegExp(`no recorded review for ${head.slice(0, 7)}`));
	const finding = "#### Critical\n`a.ts:1` · any input · wrong total · seen in code · fix the sum";
	handle({ session_id: "s", cwd: projectDir, hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `${finding}\n### Verdict\nReviewed BASE: ${git("rev-parse", "main")}\nReviewed HEAD: ${head}\nReady to merge: No`, prompt_id: "p1", agent_id: "a1" }, env);
	mkdirSync(join(projectDir, "src"));
	const worktree = join(mkdtempSync(join(tmpdir(), "hooks-wt-")), "r");
	git("worktree", "add", "-q", "--detach", worktree, head);
	for (const cwd of [projectDir, join(projectDir, "src"), worktree]) {
		const printed = log(cwd);
		assert.equal(printed.status, 0, `${cwd}: ${printed.stderr}`);
		assert.match(printed.stdout, /## Reviewer run a1 — No/);
		assert.match(printed.stdout, /`a\.ts:1` · any input · wrong total/);
	}
});

test("review gate: a successful gh pr create registers its branch for the push gate; a failed one does not", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	const remote = mkdtempSync(join(tmpdir(), "hooks-remote-"));
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("remote", "add", "origin", remote);
	git("push", "-q", "origin", "main");
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const env: HookEnv = { root, projectDir, stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")), reviewsRoot: mkdtempSync(join(tmpdir(), "hooks-reviews-")) };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const push = () => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push" } }));
	const create = (id: string) => call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: id, tool_input: { command: "gh pr create --fill" } });
	create("t1");
	call({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "gh pr create --fill" } });
	assert.equal(push(), undefined, "a failed PR creation opened nothing: pushing the own work branch asks nothing");
	create("t2");
	// The shell's cwd may have moved by the time the result arrives: the branch comes from where the command started.
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "t2", cwd: tmpdir(), tool_input: { command: "gh pr create --fill" } });
	assert.equal(push(), "deny", "the branch now has an open PR");
});

test("guard: inside the kit reviewer a writing command is denied; the main agent's isn't touched by that rule", () => {
	const { call } = setup();
	const pre = (agent_type: string | undefined) => call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git commit -qm x" }, ...(agent_type ? { agent_type, agent_id: "a1" } : {}) });
	for (const agent of ["eng-kit:reviewer", "reviewer"]) {
		const out = pre(agent).output?.hookSpecificOutput as Record<string, unknown> | undefined;
		assert.equal(out?.permissionDecision, "deny", agent);
		assert.match(String(out?.permissionDecisionReason), /reviewer is read-only/);
	}
	const ps = call({ hook_event_name: "PreToolUse", tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" }, agent_type: "eng-kit:reviewer", agent_id: "a1" });
	assert.equal((ps.output?.hookSpecificOutput as Record<string, unknown> | undefined)?.permissionDecision, "deny", "PowerShell in the reviewer");
	assert.doesNotMatch(JSON.stringify(pre(undefined)), /reviewer is read-only/);
	assert.doesNotMatch(JSON.stringify(pre("Explore")), /reviewer is read-only/);
});

test("a crash while handling PreToolUse asks with the error instead of failing open; other events keep exit 1", () => {
	const env = (input: HookInput): HookEnv => ({ root, projectDir: input.cwd ?? tmpdir(), stateDir: mkdtempSync(join(tmpdir(), "hooks-state-")) });
	const boom = (): never => {
		throw new Error("boom");
	};
	const pre = respond(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push" } }), env, boom);
	assert.equal(pre.code, 0);
	const out = JSON.parse(pre.stdout).hookSpecificOutput;
	assert.equal(out.permissionDecision, "ask");
	assert.match(out.permissionDecisionReason, /eng-kit guard failed: boom/);
	for (const raw of [JSON.stringify({ hook_event_name: "Stop" }), "{not json"]) {
		const other = respond(raw, env, boom);
		assert.equal(other.code, 1, raw);
		assert.equal(other.stdout, "", raw);
	}
	const ok = respond(JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s" }), env);
	assert.equal(ok.code, 0, "a normal call still works");
});
