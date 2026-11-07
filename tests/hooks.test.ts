import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { slowGit } from "./slow-git.ts";
import { BOOTSTRAP_MARKER, handle, respond, runsVerifyScript, type HookEnv, type HookInput } from "../lib/hooks.ts";
import { readReports, readReviews, recordVerdict, reviewsDir } from "../lib/reviews.ts";
import { branchSummary } from "../lib/usage.ts";
import { loadState, readRun, readRunStart, runFile, saveState, writeRun } from "../lib/state.ts";

/** Temp folders this file makes, removed when its tests end. */
const made: string[] = [];
after(() => {
	for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}


// Isolate git from the machine's own config (the guard's git calls inherit this process's environment).
process.env.HOME = mkdtempSync(join(tmpdir(), "home-"));
process.env.XDG_CONFIG_HOME = join(process.env.HOME, ".config");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const root = resolve(import.meta.dirname, "..");

function setup(files: Record<string, string> = { "CLAUDE.md": "## Commands\n- `npm test`\n- `npm run typecheck`\n" }) {
	const projectDir = temp("hooks-project-");
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(resolve(projectDir, name, ".."), { recursive: true });
		writeFileSync(join(projectDir, name), content);
	}
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-") };
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
	assert.match(out.additionalContext!, /Kit commands the user types: `\/eng-kit:<name>`/, "plugin layout");
});

test("SessionStart names the user commands without a prefix in a project install", () => {
	const project = mkdtempSync(join(tmpdir(), "hooks-install-"));
	mkdirSync(join(project, ".claude", "skills", "using-skills"), { recursive: true });
	mkdirSync(join(project, ".claude", "eng-kit"), { recursive: true });
	writeFileSync(join(project, ".claude", "skills", "using-skills", "SKILL.md"), "---\nname: using-skills\n---\n## The rule\n");
	const env: HookEnv = { root: join(project, ".claude", "eng-kit"), projectDir: project, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-") };
	const out = handle({ session_id: "s1", cwd: project, hook_event_name: "SessionStart", source: "startup" }, env).output!.hookSpecificOutput as Record<string, string>;
	assert.match(out.additionalContext!, /Kit commands the user types: `\/<name>`/);
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

test("runsVerifyScript recognises only a run of the kit's own script", () => {
	const runs: Array<[string, string, string]> = [
		['node "/k/scripts/verify.ts"', "/k", "/p"],
		["node /k/scripts/verify.ts 2>&1 | tail -30", "/k", "/p"],
		["node /k/scripts/verify.ts | tee log", "/k", "/p"],
		['node "/a b/scripts/verify.ts"', "/a b", "/p"],
		["node .claude/eng-kit/scripts/verify.ts", "/p/.claude/eng-kit", "/p"],
		["node C:\\k\\scripts\\verify.ts", "C:\\k", "/p"],
		['node "/k/scripts/verify.ts" \\\n  2>&1 | tail -30', "/k", "/p"],
		['node "C:\\k\\scripts\\verify.ts" 2>&1 | Select-Object -Last 30', "C:\\k", "/p"],
		["node /k/scripts/verify.ts | select -Last 5", "/k", "/p"],
		["node /k/scripts/verify.ts | Select-String FAIL", "/k", "/p"],
		["node /k/scripts/verify.ts | sls FAIL", "/k", "/p"],
		["node /k/scripts/verify.ts | Tee-Object log", "/k", "/p"],
		["node /k/scripts/verify.ts |& tail -30", "/k", "/p"],
		["node /k/scripts/verify.ts 2>&1 |\n  tail -30", "/k", "/p"],
		['& node "C:\\k\\scripts\\verify.ts"', "C:\\k", "/p"],
		["node /k/scripts/verify.ts;", "/k", "/p"],
		['node "/R&D/kit/scripts/verify.ts"', "/R&D/kit", "/p"],
		['node "C:\\Users\\O\'Brien\\kit\\scripts\\verify.ts"', "C:\\Users\\O'Brien\\kit", "/p"],
	];
	for (const [command, kit, cwd] of runs) assert.equal(runsVerifyScript(command, kit, cwd), true, command);
	const mentions = [
		"cat /k/scripts/verify.ts",
		"grep x /k/scripts/verify.ts",
		"sed -n 1p /k/scripts/verify.ts",
		"node /p/scripts/verify.ts",
		"cd x && node /k/scripts/verify.ts",
		"node /k/scripts/verify.ts; tail -5 log",
		"node /k/scripts/verify.ts &",
		"node /k/scripts/verify.ts 2>&1 &",
		'node /k/x\\"; exit 0; \\"/../../scripts/verify.ts',
		"cat > notes <<'EOF'\nnode /k/scripts/verify.ts\nEOF",
	];
	for (const command of mentions) assert.equal(runsVerifyScript(command, "/k", "/p"), false, command);
});

test("verify gate: mentioning the verify script doesn't clear it", () => {
	const script = join(root, "scripts", "verify.ts");
	for (const command of [`cat ${script}`, `grep x ${script}`, `sed -n 1p ${script}`, "node scripts/verify.ts", `cd src && node ${script}`]) {
		const { call, projectDir } = setup();
		call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(projectDir, "src/a.ts") } });
		call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command } });
		assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block", command);
	}
});

test("verify gate: without a run record, a piped or background run of the script doesn't clear it", () => {
	const script = join(root, "scripts", "verify.ts");
	for (const command of [`node "${script}" | tail -5`, `node "${script}" &`]) {
		const { call, projectDir } = setup();
		call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(projectDir, "src/a.ts") } });
		call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command } });
		assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block", command);
	}
});

test("verify gate: failed edits and masked exit codes prove nothing", () => {
	const { call } = setup();
	call({ hook_event_name: "PostToolUseFailure", tool_name: "Edit", tool_input: {} });
	assert.equal(call({ hook_event_name: "Stop" }).output, undefined);

	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: {} });
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node scripts/verify.ts | tail -5" } });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
	assert.equal(runsVerifyScript('node "/k/scripts/verify.ts"', "/k", "/p"), true);
	assert.equal(runsVerifyScript("node C:\\k\\scripts\\verify.ts", "C:\\k", "/p"), true);
	assert.equal(runsVerifyScript("node /k/scripts/verify.ts | tee log", "/k", "/p"), true, "a pipe is fine: the script records its own result");
});

test("verify gate without commands notifies once and doesn't block", () => {
	const { call } = setup({});
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} });
	const first = call({ hook_event_name: "Stop" }).output!;
	assert.equal(first.decision, undefined, "nothing to run, so the agent isn't sent back");
	assert.match(String(first.systemMessage), /no verification commands/i);
	assert.match(String(first.systemMessage), /kit-init/);
	assert.match(String(first.systemMessage), /\.claude\/verify\.json/);
	call({ hook_event_name: "UserPromptSubmit" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {} });
	assert.deepEqual(call({ hook_event_name: "Stop" }), {}, "once per session");
});

/** `setup` in a git repository with `src/a.ts` committed, so shell changes are found from the working tree. */
function setupGit(files: Record<string, string> = { "CLAUDE.md": "## Commands\n- `npm test`\n- `npm run typecheck`\n" }) {
	const ctx = setup({ ...files, "src/a.ts": "export const a = 1;\n" });
	const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: ctx.projectDir, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git("commit", "-q", "-m", "initial");
	const edit = (content: string) => writeFileSync(join(ctx.projectDir, "src/a.ts"), content);
	let calls = 0;
	/** One shell call as Claude Code reports it: PreToolUse, the command running (`during`), then its result. */
	const bash = (command: string, extra: Partial<HookInput> = {}, during = () => {}) => {
		const tool_use_id = extra.tool_use_id ?? `toolu_${++calls}`;
		ctx.call({ ...extra, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id });
		during();
		return ctx.call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, ...extra, tool_use_id });
	};
	return { ...ctx, git, edit, bash };
}

test("verify gate: a file changed from the shell marks the workspace, also when the command fails", () => {
	const { call, edit, bash } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	edit("export const a = 2;\n");
	bash("cat > src/a.ts <<'EOF'\nexport const a = 2;\nEOF");
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /Verify gate/);
	assert.match(reason, /src\/a\.ts/);

	call({ hook_event_name: "SessionStart", source: "startup", session_id: "s2" });
	edit("export const a = 3;\n");
	bash("python3 fix.py", { hook_event_name: "PostToolUseFailure", session_id: "s2" });
	bash("npm test", { session_id: "s2" });
	assert.match(String(call({ hook_event_name: "Stop", session_id: "s2" }).output?.reason), /src\/a\.ts/, "the failed command marked it, so npm test can't absorb it");
});

test("verify gate: a shell command from another folder still has its project changes found", () => {
	const { call, edit, bash } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	edit("export const a = 2;\n");
	bash("node gen.js", { cwd: mkdtempSync(join(tmpdir(), "elsewhere-")) });
	bash("npm test");
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/, "marked by node gen.js, not absorbed by npm test");
});

test("verify gate: a change no command reported is found at Stop", () => {
	const { call, edit } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	edit("export const a = 2;\n");
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify gate: a verification run that changes files doesn't mark the workspace again", () => {
	const { call, edit, bash } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("sed -i '' 's/1/2/' src/a.ts", {}, () => edit("export const a = 2;\n"));
	bash("npm test");
	bash("npm run typecheck", {}, () => edit("export const a = 3;\n"));
	assert.deepEqual(call({ hook_event_name: "Stop" }), {}, "the typecheck run's own change keeps npm test green");
});

test("verify gate: a session without a fingerprint takes one instead of counting an edit", () => {
	const { call, edit, bash } = setupGit();
	edit("export const a = 2;\n");
	bash("ls");
	assert.deepEqual(call({ hook_event_name: "Stop" }), {});
});

test("verify gate: committing after a green run is not an edit, and a review after it counts", () => {
	const { call, edit, bash, projectDir } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	edit("export const a = 2;\n");
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(projectDir, "src/a.ts") } });
	bash("npm test");
	bash("npm run typecheck");
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qam", "a = 2"], { cwd: projectDir });
	bash("git commit -qam 'a = 2'");
	assert.deepEqual(call({ hook_event_name: "Stop" }), {});
	const review = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed BASE: x\nReviewed HEAD: y\nReady to merge: Yes", prompt_id: "p", agent_id: "r" });
	assert.doesNotMatch(String(review.warning), /unverified/);
});

test("verify gate: a write chained with a verification run, or after a failed one, is not exempt", () => {
	const cases: Array<[string, boolean, string]> = [
		["npm test && sed -i '' 's/1/2/' src/a.ts", false, "src/a.ts"],
		["npm test; cat > src/a.ts <<'EOF'\nexport const a = 2;\nEOF", false, "src/a.ts"],
		["npm test", true, "src/a.ts"],
		["cat > Makefile <<'EOF'\nnpm test\nEOF", false, "Makefile"],
	];
	for (const [command, failed, file] of cases) {
		const { call, bash, projectDir } = setupGit();
		call({ hook_event_name: "SessionStart", source: "startup" });
		bash("npm test");
		bash("npm run typecheck");
		writeFileSync(join(projectDir, file), "changed\n");
		bash(command, failed ? { hook_event_name: "PostToolUseFailure" } : {});
		assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), new RegExp(file.replace(".", "\\.")), command);
	}
});

test("verify gate: a resumed session compares with its fingerprint instead of replacing it", () => {
	const { call, edit } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	edit("export const a = 2;\n");
	call({ hook_event_name: "SessionStart", source: "resume" });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify gate: a session without a fingerprint, or with git given up, reads the command's text", () => {
	const { call } = setupGit();
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat > src/a.ts <<'EOF'\nexport const a = 2;\nEOF" }, tool_use_id: "no-pre" });
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/);

	const big = setupGit();
	mkdirSync(join(big.projectDir, "many"));
	for (let i = 0; i <= 5000; i++) writeFileSync(join(big.projectDir, "many", `${i}.txt`), "");
	big.call({ hook_event_name: "SessionStart", source: "startup" });
	big.bash("echo x > src/b.ts");
	assert.match(String(big.call({ hook_event_name: "Stop" }).output?.reason), /src\/b\.ts/);
});

test("verify gate: a broken verify.json still sends Claude back and names the error", () => {
	const { call } = setup({ ".claude/verify.json": '{"commands": ["npm test"],}', "package.json": '{"scripts":{"test":"node --test"}}' });
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const out = call({ hook_event_name: "Stop" }).output!;
	assert.equal(out.decision, "block");
	assert.match(String(out.reason), /verify\.json/);
	assert.match(String(out.reason), /JSON|parse|Unexpected|Expected/i);
});

test("review gate: detected commands don't count for the reviewer or for review verdicts", () => {
	const { call } = setup({ "package.json": '{"scripts":{"test":"node --test"}}', "package-lock.json": "{}" });
	const reviewer = call({ hook_event_name: "PreToolUse", tool_name: "Bash", agent_type: "eng-kit:reviewer", tool_input: { command: "npm test" } });
	assert.equal(decision(reviewer), "deny", "only configured commands are in the reviewer's allowlist");
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const review = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed BASE: x\nReviewed HEAD: y\nReady to merge: Yes", prompt_id: "p", agent_id: "r" });
	assert.doesNotMatch(String(review.warning), /unverified/, "no configured commands, so no Inconclusive for unverified edits");
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block", "the verify gate does use them");
});

test("verify gate: in a project with one command, a write chained after it still marks", () => {
	for (const command of ["npm test && sed -i '' 's/1/2/' src/a.ts", "npm test; cat > src/a.ts <<'EOF'\nexport const a = 2;\nEOF"]) {
		const { call, bash, edit } = setupGit({ "package.json": '{"scripts":{"test":"node --test"}}', "package-lock.json": "{}" });
		call({ hook_event_name: "SessionStart", source: "startup" });
		bash("npm test");
		bash(command, {}, () => edit("export const a = 2;\n"));
		assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/, command);
	}
});

test("verify gate: readers that write, and a check whose failure a pipe hides, are not exempt", () => {
	const cases: Array<[string, string]> = [
		["npm test && grep -v x src/a.ts > src/b.ts", "src/b.ts"],
		["npm test 2>&1 | tail -30", "src/a.ts"],
	];
	for (const [command, file] of cases) {
		const { call, bash, projectDir } = setupGit();
		call({ hook_event_name: "SessionStart", source: "startup" });
		bash("npm test");
		bash("npm run typecheck");
		bash(command, {}, () => writeFileSync(join(projectDir, file), "changed\n"));
		assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), new RegExp(file.replace(".", "\\.")), command);
	}
});

test("verify gate: a change made before a check started is not the check's own", () => {
	const { call, bash, edit, projectDir } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("npm test");
	bash("npm run typecheck");
	edit("export const a = 2;\n");
	bash("npm test");
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/, "between calls");

	const second = setupGit();
	second.call({ hook_event_name: "SessionStart", source: "startup" });
	second.bash("npm test");
	second.bash("npm run typecheck");
	const pre = (id: string, command: string) => second.call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: id });
	const post = (id: string, command: string) => second.call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: id });
	pre("A", "npm test");
	pre("B", "python3 fix.py");
	second.edit("export const a = 2;\n");
	post("A", "npm test");
	post("B", "python3 fix.py");
	assert.equal(second.call({ hook_event_name: "Stop" }).output?.decision, "block", "interleaved calls");

	const third = setupGit();
	third.call({ hook_event_name: "SessionStart", source: "startup" });
	third.bash("npm test");
	third.bash("npm run typecheck");
	const call3 = (event: string, id: string, command: string) => third.call({ hook_event_name: event, tool_name: "Bash", tool_input: { command }, tool_use_id: id });
	call3("PreToolUse", "old", "npm test");
	for (let i = 0; i < 10; i++) call3("PreToolUse", `denied-${i}`, "ls");
	third.edit("export const a = 2;\n");
	call3("PostToolUse", "old", "npm test");
	assert.equal(third.call({ hook_event_name: "Stop" }).output?.decision, "block", "a call whose snapshot was dropped isn't exempt");
	void projectDir;
});

test("verify gate: a piped verify script keeps its own writes only while its record says it passed", () => {
	for (const ok of [true, false]) {
		const { call, bash, edit, run } = setupGit();
		call({ hook_event_name: "SessionStart", source: "startup" });
		bash("npm test");
		bash("npm run typecheck");
		run(ok);
		bash(`node "${join(root, "scripts", "verify.ts")}" 2>&1 | tail -30`, {}, () => edit("export const a = 2;\n"));
		const out = call({ hook_event_name: "Stop" });
		if (ok) assert.deepEqual(out, {}, "a passing run's formatter writes are its own");
		else assert.match(String(out.output?.reason), /src\/a\.ts/, "a failing run's writes count");
	}
});

test("verify gate: git stash after a green run marks the workspace", () => {
	const { call, bash, edit, git } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("sed -i '' 's/1/2/' src/a.ts", {}, () => edit("export const a = 2;\n"));
	bash("npm test");
	bash("npm run typecheck");
	bash("git stash", {}, () => git("stash", "-q"));
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/);
});

test("verify gate: a folder that becomes a git repository mid-session is fingerprinted from then on", () => {
	const ctx = setup({ "CLAUDE.md": "## Commands\n- `npm test`\n", "src/a.ts": "export const a = 1;\n" });
	ctx.call({ hook_event_name: "SessionStart", source: "startup" });
	const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: ctx.projectDir, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git("commit", "-q", "-m", "initial");
	ctx.call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "node gen.js" }, tool_use_id: "g" });
	writeFileSync(join(ctx.projectDir, "src/a.ts"), "export const a = 2;\n");
	ctx.call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "node gen.js" }, tool_use_id: "g" });
	assert.match(String(ctx.call({ hook_event_name: "Stop" }).output?.reason), /src\/a\.ts/, "only the fingerprint can see a script's write");
});

test("verify gate: only a call the guard allows outright gets a snapshot", () => {
	const { call, env } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" }, tool_use_id: "asked" });
	call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, tool_use_id: "allowed" });
	const pending = loadState(env.stateDir, "s1").pending;
	assert.equal("asked" in pending, false, "the snapshot can't delay a question");
	assert.equal("allowed" in pending, true);
});

test("guard: a state folder that can't be written doesn't weaken a denial", () => {
	const { env, projectDir } = setup();
	chmodSync(env.stateDir, 0o500);
	try {
		const out = handle({ session_id: "s1", cwd: projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push --force origin main" }, tool_use_id: "f" }, env);
		assert.equal(decision(out), "deny");
		const allowed = handle({ session_id: "s1", cwd: projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "l" }, env);
		assert.equal(decision(allowed), undefined, "an allowed call stays allowed, not asked");
	} finally {
		chmodSync(env.stateDir, 0o700);
	}
});

test("verify gate: outside git the command's text decides", () => {
	const { call } = setup();
	const bash = (command: string, session_id: string) => call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, session_id });
	bash("echo x > src/a.ts", "w");
	assert.equal(call({ hook_event_name: "Stop", session_id: "w" }).output?.decision, "block");
	bash("echo x > /tmp/y", "t");
	assert.deepEqual(call({ hook_event_name: "Stop", session_id: "t" }), {});
});

/** `setup` in a folder outside git that holds repositories `a` (committed `f.ts`) and `b` (committed `m.ts`). */
/** `guards`: each repository's `.claude/guard.json` text, written after its first commit. */
function setupWorkspace(guards: Record<string, string> = {}) {
	const ctx = setup();
	const git = (repo: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: join(ctx.projectDir, repo), stdio: "pipe" });
	for (const [repo, file] of [["a", "f.ts"], ["b", "m.ts"]] as const) {
		mkdirSync(join(ctx.projectDir, repo));
		git(repo, "init", "-q", "-b", "main");
		writeFileSync(join(ctx.projectDir, repo, file), "export {};\n");
		git(repo, "add", "-A");
		git(repo, "commit", "-q", "-m", "initial");
	}
	for (const [repo, text] of Object.entries(guards)) {
		mkdirSync(join(ctx.projectDir, repo, ".claude"), { recursive: true });
		writeFileSync(join(ctx.projectDir, repo, ".claude", "guard.json"), text);
	}
	let calls = 0;
	const bash = (command: string, during = () => {}) => {
		const tool_use_id = `toolu_${++calls}`;
		ctx.call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id });
		during();
		return ctx.call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id });
	};
	return { ...ctx, git, bash };
}

test("guard: in a workspace, a Write of a repository's CI pipeline asks", () => {
	const { call, projectDir } = setupWorkspace();
	const write = call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", ".github", "workflows", "ci.yml"), content: "x" } });
	assert.equal(decision(write), "ask");
	assert.match((write.output!.hookSpecificOutput as Record<string, string>).permissionDecisionReason!, /CI\/release pipeline/);
});

test("guard: in a workspace, a shell write of a repository's guard config asks", () => {
	const { call } = setupWorkspace();
	for (const command of ["echo {} > a/.claude/guard.json", "cd a && echo {} > .claude/guard.json", "cd a/.claude && echo '{}' > guard.json"]) {
		assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } })), "ask", command);
	}
});

test("guard: in a workspace, a repository's own rules judge what lands in it", () => {
	const { call } = setupWorkspace({ a: JSON.stringify({ protectedPaths: ["secret/"], block: ["make release"] }) });
	const bash = (command: string) => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }));
	assert.equal(bash("cat > a/secret/x <<'EOF'\nx\nEOF"), "deny", "a heredoc write under a's protected path");
	assert.equal(bash("cat > b/secret/x <<'EOF'\nx\nEOF"), undefined);
	assert.equal(bash("cd a && make release"), "deny");
	assert.equal(bash("cd b && make release"), undefined);
});

test("guard: in a workspace, a repository's reviewGate waiver covers its own PRs only", () => {
	const { call } = setupWorkspace({ a: JSON.stringify({ reviewGate: false }) });
	call({ hook_event_name: "SessionStart", source: "startup" });
	const bash = (command: string) => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }));
	assert.equal(bash("cd a && gh pr create --fill"), undefined);
	assert.equal(bash("cd b && gh pr create --fill"), "deny");
});

test("guard: in a workspace, the main agent pushes a repository's work branch; the implementer is asked", () => {
	const { call, git, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("a", "remote", "add", "origin", remote);
	git("a", "push", "-q", "origin", "main");
	git("a", "switch", "-qc", "feat/x");
	const pre = (agent_type?: string) => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git -C a push" }, cwd: projectDir, agent_type }));
	assert.equal(pre(), undefined);
	assert.equal(pre("eng-kit:implementer"), "ask");
});

test("guard: in a workspace, a repository cloned after the session started pushes only with a question", () => {
	const { call, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	const c = join(projectDir, "c");
	const run = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: c });
	mkdirSync(c);
	run("init", "-q", "-b", "main");
	run("commit", "-q", "--allow-empty", "-m", "init");
	run("remote", "add", "origin", remote);
	run("push", "-q", "origin", "main");
	run("switch", "-qc", "feat/x");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git -C c push" }, cwd: projectDir })), "ask");
});

test("guard: in a workspace, an invalid regex in a repository config is named with that config", () => {
	const { call, projectDir } = setupWorkspace({ a: JSON.stringify({ block: ["(unclosed"] }) });
	const write = call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "x.ts"), content: "x" } });
	assert.match(String(write.warning), /invalid regex ignored in a\/\.claude\/guard\.json: \(unclosed/);
});

test("guard: in a workspace, a lost session state lets no repository loosen the guard or push silently", () => {
	const { call, env, git } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("a", "remote", "add", "origin", remote);
	git("a", "push", "-q", "origin", "main");
	git("a", "switch", "-qc", "feat/x");
	for (const f of readdirSync(env.stateDir)) rmSync(join(env.stateDir, f));
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git -C a push" } })), "ask");
});

test("guard: a resumed session keeps the baseline it started with", () => {
	const { call, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	const c = join(projectDir, "c");
	const run = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: c });
	mkdirSync(c);
	run("init", "-q", "-b", "main");
	run("commit", "-q", "--allow-empty", "-m", "init");
	run("remote", "add", "origin", remote);
	run("push", "-q", "origin", "main");
	run("switch", "-qc", "feat/x");
	call({ hook_event_name: "SessionStart", source: "resume" });
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git -C c push" } })), "ask");
});

test("guard: the kit's session state can't be written by another spelling of its path either", () => {
	const { call, env } = setupWorkspace();
	// As in plugin mode, the state is a `sessions` folder inside the kit's own data folder.
	env.stateDir = join(temp("hooks-data-"), "sessions");
	mkdirSync(env.stateDir);
	const real = join(realpathSync(env.stateDir), "s1.json");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: real, content: "{}" } })), "deny", "its real path");
	const rel = relative(realpathSync(tmpdir()), realpathSync(env.stateDir));
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `echo '{}' > $TMPDIR/${rel}/s1.json` } })), "deny", "through $TMPDIR");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `mv ${dirname(env.stateDir)} /tmp/moved` } })), "deny", "a parent folder");
	const parent = dirname(env.stateDir);
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo '{}' > ${TMPDIR}" + rel + "/s1.json" } })), "deny", "${TMPDIR} glued to the rest");
	for (const command of [`find ${parent} -name settings.json`, `cp notes.md ${parent}/`, `mkdir -p ${parent}/other`]) {
		assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } })), undefined, `a parent folder only for a removal or move: ${command}`);
	}
});

test("guard: a compaction after the baseline was lost stays strict", () => {
	const { call, env, git } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("a", "remote", "add", "origin", remote);
	git("a", "push", "-q", "origin", "main");
	git("a", "switch", "-qc", "feat/x");
	for (const f of readdirSync(env.stateDir)) rmSync(join(env.stateDir, f));
	call({ hook_event_name: "SessionStart", source: "compact" });
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git -C a push" } })), "ask");
});

test("guard: the kit's session state can't be written by a tool call", () => {
	const { call, env } = setupWorkspace();
	const file = join(env.stateDir, "s1.json");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "{}" } })), "deny");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `rm ${file}` } })), "deny");
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `echo '{}' > ${file}` } })), "deny");
});

test("Stop: a repository config that appeared after the session started can't silence its task-file reminders", () => {
	const { call, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	mkdirSync(join(projectDir, "a", ".claude"));
	writeFileSync(join(projectDir, "a", ".claude", "guard.json"), JSON.stringify({ workDocs: ["plans"] }));
	mkdirSync(join(projectDir, "a", "docs", "tasks"), { recursive: true });
	writeFileSync(join(projectDir, "a", "docs", "tasks", "t.md"), "# T\n\nStatus: design approved (2026-11-04)\n");
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /a\/docs\/tasks\/t\.md/);
});

test("guard: a Read through a symlink to a secret file is denied", () => {
	const { call, projectDir } = setupWorkspace();
	writeFileSync(join(projectDir, "a", ".env"), "TOKEN=x\n");
	symlinkSync(join(projectDir, "a", ".env"), join(projectDir, "a", "dev.cfg"));
	assert.equal(decision(call({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(projectDir, "a", "dev.cfg") } })), "deny");
});

test("guard: in a workspace, an invalid repository config warns with its path and is ignored", () => {
	const { call, projectDir } = setupWorkspace({ a: "{" });
	const write = call({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "x.ts"), content: "x" } });
	assert.equal(decision(write), undefined);
	assert.match(String(write.warning), /a[\\/]\.claude[\\/]guard\.json/);
});

test("Stop names a workspace repository's approved and finished task files", () => {
	const { call, git, projectDir } = setupWorkspace();
	mkdirSync(join(projectDir, "a", "docs", "tasks"), { recursive: true });
	writeFileSync(join(projectDir, "a", "docs", "tasks", "t.md"), "# T\n\nStatus: design approved (2026-11-03)\n");
	mkdirSync(join(projectDir, "b", "docs", "tasks"), { recursive: true });
	writeFileSync(join(projectDir, "b", "docs", "tasks", "done.md"), "# D\n\n## Plan\n\n- [x] one\n\n## Progress\n");
	git("b", "add", "-A");
	git("b", "commit", "-q", "-m", "done");
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /Approval gate: .*a\/docs\/tasks\/t\.md/);
	assert.match(reason, /You are on main in a/, "a's own base branch");
	assert.match(reason, /Working-docs gate: .*b\/docs\/tasks\/done\.md/);
});

test("verify gate: in a workspace, a redirect to an unknown variable path marks nothing", () => {
	const { call, bash } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("cd a && true > $S/red.log");
	bash('S=$(mktemp -d); for e in x y; do true > $S/t-$e.log; done');
	assert.deepEqual(call({ hook_event_name: "Stop" }), {});
});

test("verify gate: in a workspace, a shell write in a repository marks it with its folder", () => {
	const { call, bash, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("echo x > a/f.ts", () => writeFileSync(join(projectDir, "a", "f.ts"), "x\n"));
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /a\/f\.ts/);
});

test("verify gate: in a workspace, a write or a commit between calls is found at Stop", () => {
	const { call, git, projectDir } = setupWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	writeFileSync(join(projectDir, "b", "c.ts"), "export {};\n");
	git("b", "add", "c.ts");
	git("b", "commit", "-q", "-m", "c");
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /b\/c\.ts/, "a subagent's commit in a repository");

	call({ hook_event_name: "SessionStart", source: "startup", session_id: "s2" });
	writeFileSync(join(projectDir, "loose.js"), "1;\n");
	assert.match(String(call({ hook_event_name: "Stop", session_id: "s2" }).output?.reason), /loose\.js/, "a file outside the repositories");
});

test("verify gate: a workspace repository late twice running is remembered for the session, so later calls don't wait on it", () => {
	const { call, projectDir, env } = setupWorkspace();
	const { log, restore } = slowGit(realpathSync(join(projectDir, "a")));
	try {
		call({ hook_event_name: "SessionStart", source: "startup" });
		assert.deepEqual(loadState(env.stateDir, "s1").slowParts, [], "late once");
		call({ hook_event_name: "Stop" });
		assert.deepEqual(loadState(env.stateDir, "s1").slowParts, ["a"], "late twice running");
		const calls = readFileSync(log, "utf8");
		call({ hook_event_name: "UserPromptSubmit" });
		call({ hook_event_name: "Stop" });
		assert.equal(readFileSync(log, "utf8"), calls, "no git in the remembered repository");
	} finally {
		restore();
	}
});

test("verify gate: in a workspace, an edit a glob ignores by its path inside the repository isn't counted", () => {
	const { call, projectDir } = setupWorkspace();
	writeFileSync(join(projectDir, "CLAUDE.md"), "## Commands\n- `npm test`\n");
	mkdirSync(join(projectDir, ".claude"));
	writeFileSync(join(projectDir, ".claude", "verify.json"), JSON.stringify({ commands: ["npm test"], ignore: ["docs/**"] }));
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "docs", "d.svg") } });
	assert.deepEqual(call({ hook_event_name: "Stop" }), {});
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "src", "d.ts") } });
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /a\/src\/d\.ts/);
});

test("verify gate: in a workspace, a repository's files follow its own ignore globs, in edits, shell writes and commits", () => {
	const { call, projectDir, git, bash } = setupWorkspace();
	mkdirSync(join(projectDir, ".claude"));
	writeFileSync(join(projectDir, ".claude", "verify.json"), JSON.stringify({ commands: ["npm test"], ignore: ["scripts/**"] }));
	call({ hook_event_name: "SessionStart", source: "startup" });
	bash("git -C a commit", () => {
		mkdirSync(join(projectDir, "a", "docs"));
		writeFileSync(join(projectDir, "a", "docs", "setup.yaml"), "x: 1\n");
		git("a", "add", "docs/setup.yaml");
		git("a", "commit", "-q", "-m", "docs");
	});
	assert.deepEqual(call({ hook_event_name: "Stop" }), {}, "a's default docs/** ignores its committed docs file");
	call({ hook_event_name: "UserPromptSubmit" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "scripts", "build.ts") } });
	assert.match(String(call({ hook_event_name: "Stop" }).output?.reason), /a\/scripts\/build\.ts/, "the workspace's scripts/** is for the workspace's own folder");
});

test("verify gate: a saved tree from before workspaces loads; a malformed workspace field drops it", () => {
	const { env } = setup();
	const save = (tree: unknown) => writeFileSync(join(env.stateDir, "t.json"), JSON.stringify({ tree }));
	save({ head: "abc", files: { "src/a.ts": "1 2" } });
	assert.deepEqual(loadState(env.stateDir, "t").tree, { head: "abc", files: { "src/a.ts": "1 2" } });
	save({ head: "", files: {}, heads: { a: "abc" }, blind: [""] });
	assert.deepEqual(loadState(env.stateDir, "t").tree?.blind, [""]);
	save({ head: "", files: {}, heads: { a: 1 }, blind: [] });
	assert.equal(loadState(env.stateDir, "t").tree, undefined, "a non-string HEAD");
	save({ head: "", files: {}, heads: {}, blind: "a" });
	assert.equal(loadState(env.stateDir, "t").tree, undefined, "blind is a list");
});

test("verify gate: outside git, $HOME is the shell's in Bash and PowerShell's own variable in PowerShell", () => {
	const { call } = setup();
	const run = (tool_name: string, session_id: string) => call({ hook_event_name: "PostToolUse", tool_name, tool_input: { command: "echo x > $HOME/a.ts" }, session_id });
	run("Bash", "b");
	assert.deepEqual(call({ hook_event_name: "Stop", session_id: "b" }), {}, "a write into the home folder");
	run("PowerShell", "p");
	assert.equal(call({ hook_event_name: "Stop", session_id: "p" }).output?.decision, "block", "a write the hook can't place");
});

test("verify gate: the send-back asks for the complete final report", () => {
	const { call } = setup();
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const reason = String(call({ hook_event_name: "Stop" }).output?.reason);
	assert.match(reason, /complete final report/);
	assert.match(reason, /what changed/);
	assert.match(reason, /what the user must do next/);
	assert.match(reason, /the checks you ran and their results/);
});

test("hook.ts end to end: stdin JSON in, hook JSON out", () => {
	const { projectDir } = setup();
	const run = (input: HookInput) =>
		spawnSync(process.execPath, [join(root, "hooks", "hook.ts")], {
			input: JSON.stringify({ session_id: "e2e", cwd: projectDir, ...input }),
			encoding: "utf8",
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: temp("hooks-data-") },
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

test("verify.ts records its start before running and its start time when done", () => {
	const project = temp("hooks-project-");
	const record = JSON.stringify(runFile(project));
	mkdirSync(join(project, ".claude"));
	writeFileSync(join(project, ".claude", "verify.json"), JSON.stringify({ commands: [`node -e "console.log(require('fs').readFileSync(${record.replaceAll('"', '\\"')}, 'utf8')); process.exit(1)"`] }));
	const out = spawnSync(process.execPath, [join(root, "scripts", "verify.ts"), project], { encoding: "utf8" });
	assert.equal(out.status, 1, out.stdout);
	assert.match(out.stdout, /"running":true/);
	assert.match(out.stdout, /"pid":\d+/);
	const done = readRun(project)!;
	assert.equal(done.ok, false);
	assert.equal(typeof done.startedAt, "number");
	assert.ok(done.startedAt! <= done.finishedAt);
	rmSync(runFile(project), { force: true });
});

test("verify.ts records the commands it ran, not the ones configured after the run", () => {
	const project = temp("hooks-project-");
	mkdirSync(join(project, ".claude"));
	const config = JSON.stringify(join(project, ".claude", "verify.json"));
	const rewrite = `node -e "require('fs').writeFileSync(${config.replaceAll('"', '\\"')}, JSON.stringify({commands: ['echo other']}))"`;
	writeFileSync(join(project, ".claude", "verify.json"), JSON.stringify({ commands: [rewrite] }));
	const out = spawnSync(process.execPath, [join(root, "scripts", "verify.ts"), project], { encoding: "utf8" });
	assert.equal(out.status, 0, out.stdout);
	assert.deepEqual(readRun(project)!.commands, [rewrite]);
	rmSync(runFile(project), { force: true });
});

test("readRun ignores a run still in progress; an old record loads without a start", () => {
	const { projectDir, env } = setup();
	writeRun(projectDir, { running: true, pid: 4242, startedAt: 1000, commands: ["npm test"] }, env.runsRoot);
	assert.equal(readRun(projectDir, env.runsRoot), undefined);
	assert.deepEqual(readRunStart(projectDir, env.runsRoot), { running: true, pid: 4242, startedAt: 1000, commands: ["npm test"] });

	writeRun(projectDir, { ok: true, commands: ["npm test"], finishedAt: 2000 }, env.runsRoot);
	assert.deepEqual(readRun(projectDir, env.runsRoot), { ok: true, commands: ["npm test"], finishedAt: 2000, startedAt: undefined });
	assert.equal(readRunStart(projectDir, env.runsRoot), undefined);
});

test("verify gate: a piped verify run counts when the script recorded a passing run", () => {
	const { call, run } = setup();
	const edit = () => call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.go" } });
	const verify = (command = `node "${join(root, "scripts", "verify.ts")}" 2>&1 | tail -30`) => call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command } });
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

/**
 * `setupGit` with an edit made, and the kit's verify script launched through PreToolUse and PostToolUse; with
 * `startedFirst`, the script has written its start record by the time Claude Code reports the call.
 */
function launchedVerify(input: Record<string, unknown> = { run_in_background: true }, startedFirst = false) {
	const ctx = setupGit();
	ctx.call({ hook_event_name: "SessionStart", source: "startup" });
	ctx.call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const command = `node "${join(root, "scripts", "verify.ts")}"`;
	const commands = ["npm test", "npm run typecheck"];
	ctx.call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, ...input }, tool_use_id: "toolu_verify" });
	if (startedFirst) writeRun(ctx.projectDir, { running: true, pid: process.pid, startedAt: Date.now(), commands }, ctx.env.runsRoot);
	ctx.call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command, ...input }, tool_use_id: "toolu_verify" });
	const finished = (fields: Partial<{ ok: boolean; commands: string[]; startedAt: number; finishedAt: number }> = {}) =>
		writeRun(ctx.projectDir, { ok: true, commands, startedAt: Date.now(), finishedAt: Date.now(), ...fields }, ctx.env.runsRoot);
	const started = (pid: number) => writeRun(ctx.projectDir, { running: true, pid, startedAt: Date.now(), commands }, ctx.env.runsRoot);
	const stop = () => ctx.call({ hook_event_name: "Stop" }).output;
	return { ...ctx, finished, started, stop };
}

/** Moves the launch, and the setup's edit before it, a second back, so a record can start after both and before a later change. */
function pinLaunch(launched: ReturnType<typeof launchedVerify>): number {
	const launch = Date.now() - 1000;
	saveState(launched.env.stateDir, "s1", { ...loadState(launched.env.stateDir, "s1"), verifyLaunch: launch, editedAt: launch - 1 });
	return launch;
}

test("verify gate: a background verify run this session launched counts when it finishes green", () => {
	const { finished, stop } = launchedVerify();
	finished();
	assert.equal(stop(), undefined);
});

test("verify gate: a verify call moved to the background counts when it finishes green, at Stop or the next shell call", () => {
	const atStop = launchedVerify({}, true);
	assert.equal(loadState(atStop.env.stateDir, "s1").unverified, true, "its result, reported while the run goes on, proves nothing");
	atStop.finished();
	assert.equal(atStop.stop(), undefined, "Stop settles it");

	const atCall = launchedVerify({}, true);
	atCall.finished();
	atCall.bash("ls");
	assert.equal(loadState(atCall.env.stateDir, "s1").unverified, false, "the next shell call settles it");
});

test("verify gate: a launched run that failed, ran other commands or started too early doesn't count", () => {
	const cases: Array<[string, (l: ReturnType<typeof launchedVerify>) => void]> = [
		["failed", (l) => l.finished({ ok: false })],
		["other commands", (l) => l.finished({ commands: ["npm test"] })],
		["finished before the launch", (l) => l.finished({ startedAt: Date.now() - 60_000, finishedAt: Date.now() - 30_000 })],
		["started before the last edit", (l) => {
			// With no edit after `pinLaunch`, this record counts (see the control in the next test).
			const launch = pinLaunch(l);
			l.call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/b.ts" } });
			l.finished({ startedAt: launch + 1 });
		}],
	];
	for (const [name, act] of cases) {
		const launched = launchedVerify();
		act(launched);
		launched.stop();
		assert.equal(loadState(launched.env.stateDir, "s1").unverified, true, name);
	}
});

test("verify gate: a change after a launched run started keeps the workspace unverified", () => {
	const control = launchedVerify();
	control.finished({ startedAt: pinLaunch(control) + 1 });
	assert.equal(control.stop(), undefined, "the same run with no change after its start counts");

	const edited = launchedVerify();
	const launch = pinLaunch(edited);
	edited.call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/b.ts" } });
	edited.finished({ startedAt: launch + 1 });
	assert.equal(edited.stop()?.decision, "block", "an edit during the run");

	const written = launchedVerify();
	written.finished({ startedAt: pinLaunch(written) + 1 });
	written.edit("export const a = 9;\n");
	assert.equal(written.stop()?.decision, "block", "a write the Stop snapshot finds");
});

test("verify gate: Stop waits while a launched run is alive, then judges by its record", () => {
	const { started, finished, stop, env } = launchedVerify();
	started(process.pid);
	assert.equal(stop(), undefined, "silent while the run is going");
	assert.equal(loadState(env.stateDir, "s1").reminded, false, "the reminder isn't used up");
	finished();
	assert.equal(stop(), undefined);
	assert.equal(loadState(env.stateDir, "s1").unverified, false);
});

test("verify gate: a launch whose run died, or that never started, no longer holds Stop", () => {
	const dead = launchedVerify();
	dead.started(spawnSync(process.execPath, ["-e", ""]).pid!);
	assert.equal(dead.stop()?.decision, "block", "a dead pid with no result");

	const stale = launchedVerify();
	saveState(stale.env.stateDir, "s1", { ...loadState(stale.env.stateDir, "s1"), verifyLaunch: Date.now() - 120_000 });
	assert.equal(stale.stop()?.decision, "block", "no record two minutes after the launch");
});

test("verify gate: a background verify call reported as failed doesn't hold Stop", () => {
	const { call } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const tool_input = { command: `node "${join(root, "scripts", "verify.ts")}"`, run_in_background: true };
	call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input, tool_use_id: "toolu_failed" });
	call({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input, tool_use_id: "toolu_failed" });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

/** Whether this user may not signal `pid`: the premise of a test about another user's process. */
function signalDenied(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

test("verify gate: a report of a verify call whose command is no longer the script launches nothing", () => {
	const { call } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	const verify = { command: `node "${join(root, "scripts", "verify.ts")}"`, run_in_background: true };
	call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: verify, tool_use_id: "toolu_rewritten" });
	// Another hook rewrote the command before it ran.
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls", run_in_background: true }, tool_use_id: "toolu_rewritten" });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify gate: a verify call Claude Code never ran doesn't hold Stop", () => {
	const { call } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	// Allowed by the guard, then denied by a permission rule or another hook: no PostToolUse follows.
	call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `node "${join(root, "scripts", "verify.ts")}"` }, tool_use_id: "toolu_denied" });
	assert.equal(call({ hook_event_name: "Stop" }).output?.decision, "block");
});

test("verify gate: a start record that can't be this session's run doesn't hold Stop", () => {
	const limit = 2 * 600_000 + 60_000; // two commands, the default 600 s each, and a minute
	const records: Array<[string, (now: number) => { pid: number; startedAt: number }]> = [
		["a run older than its commands' timeouts", (now) => ({ pid: process.pid, startedAt: now - limit - 1000 })],
		["a start in the future", (now) => ({ pid: process.pid, startedAt: now + 60_000 })],
		["pid 0", (now) => ({ pid: 0, startedAt: now })],
		["a negative pid", (now) => ({ pid: -1, startedAt: now })],
		// The script runs as the hook's user; a process it may not signal is someone else's (pid 1, where this user can't).
		...(signalDenied(1) ? [["another user's process", (now: number) => ({ pid: 1, startedAt: now })] as [string, (now: number) => { pid: number; startedAt: number }]] : []),
	];
	for (const [name, make] of records) {
		const launched = launchedVerify();
		const now = Date.now();
		const { pid, startedAt } = make(now);
		saveState(launched.env.stateDir, "s1", { ...loadState(launched.env.stateDir, "s1"), verifyLaunch: Math.min(startedAt, now) - 1 });
		writeRun(launched.projectDir, { running: true, pid, startedAt, commands: ["npm test", "npm run typecheck"] }, launched.env.runsRoot);
		assert.equal(launched.stop()?.decision, "block", name);
	}
});

test("verify gate: a green record nobody in this session launched isn't credited", () => {
	const { call, projectDir, env } = setupGit();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: `node "${join(root, "scripts", "verify.ts")}"`, run_in_background: true } });
	writeRun(projectDir, { ok: true, commands: ["npm test", "npm run typecheck"], startedAt: Date.now(), finishedAt: Date.now() }, env.runsRoot);
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
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-") };
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
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-") };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const bash = (command: string) => call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

	const pr = bash("gh pr create --fill");
	assert.equal(decision(pr), "deny");
	assert.match((pr.output!.hookSpecificOutput as Record<string, string>).permissionDecisionReason!, /^Guard: Task files would reach .*docs\/tasks\/p\.md/);
	assert.notEqual(decision(bash("git push -u origin feat/a")), "deny", "the task-file gate does not refuse a push of the work branch");
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
	const offEnv: HookEnv = { ...env, projectDir: off, stateDir: temp("hooks-state-") };
	const offPr = handle({ session_id: "s", cwd: off, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create" } }, offEnv);
	const offReason = String((offPr.output?.hookSpecificOutput as Record<string, string> | undefined)?.permissionDecisionReason);
	assert.doesNotMatch(offReason, /Task files/, "workDocs: [] opts out");
	assert.match(offReason, /Review gate: no reviewer verdict/, "the branch changes .claude/guard.json, which needs a review");
	assert.equal(handle({ session_id: "s", cwd: off, hook_event_name: "Stop" }, offEnv).output, undefined);
});

test("approval gate and verify gate combine into one reminder; no git repo means no approval gate", () => {
	const projectDir = gitRepo({ "docs/tasks/p.md": "# P\n\n**Status:** plan approved\n", "CLAUDE.md": "## Commands\n- `npm test`\n" });
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-") };
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
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
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
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), runsRoot: temp("hooks-runs-"), reviewsRoot: temp("hooks-reviews-") };
	const call = (input: HookInput) => handle({ session_id: "s", cwd: projectDir, ...input }, env);
	const pr = () => decision(call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }));
	const verdict = `Reviewed BASE: ${git("rev-parse", "main")}\nReviewed HEAD: ${head}\nReady to merge: Yes`;

	call({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(projectDir, "a.ts") } });
	const stamped = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p1", agent_id: "a1" });
	assert.match(String(stamped.warning), /unverified, so it counts as Inconclusive/);
	assert.equal(readReviews(projectDir, env.reviewsRoot)[0]?.bases.length, 1, "it keeps its range, so a later round can chain through it");
	assert.equal(pr(), "deny");
	const handedBack = join(mkdtempSync(join(tmpdir(), "hooks-tx-")), "agent.jsonl");
	writeFileSync(handedBack, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "SubagentHandback", input: { message: verdict } }] } }));
	const handedBackStop = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Sent.", agent_transcript_path: handedBack, prompt_id: "p1b", agent_id: "a1b" });
	assert.match(String(handedBackStop.warning), /unverified, so it counts as Inconclusive/, "a handed-back review on unverified edits too");
	assert.equal(handedBackStop.output, undefined);

	call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: verdict, prompt_id: "p2", agent_id: "a2" });
	assert.equal(pr(), undefined, "after a green run the review counts");

	const bare = gitRepo({});
	spawnSync("git", ["switch", "-qc", "feat/b"], { cwd: bare });
	writeFileSync(join(bare, "b.ts"), "export const b = 1;\n");
	spawnSync("git", ["add", "-A"], { cwd: bare });
	spawnSync("git", ["commit", "-qm", "b"], { cwd: bare });
	const bareHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: bare, encoding: "utf8" }).stdout.trim();
	const bareEnv: HookEnv = { ...env, projectDir: bare, stateDir: temp("hooks-state-") };
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
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
	const stop = (stop_hook_active: boolean) =>
		handle({ session_id: "s", cwd: projectDir, hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed HEAD: ${head}\nReady to merge: Yes`, prompt_id: "p1", agent_id: "a1", stop_hook_active }, env);
	const first = stop(false);
	assert.equal(first.output?.decision, "block");
	assert.match(String(first.output?.reason), /exactly three lines: `Reviewed BASE: <the commit your range starts at>`, `Reviewed HEAD: <the SHA you reviewed>` and `Ready to merge:/);
	assert.equal(stop(true).output, undefined, "sent back only once");
	assert.equal(readReviews(projectDir, env.reviewsRoot)[0]?.verdict, "Inconclusive");
});

test("review gate: a background reviewer's report comes from its SubagentHandback call; without the verdict lines it counts as Inconclusive at once", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
	// Transcript lines shaped like Claude Code's: a background subagent hands its report back as a tool call, and its
	// last message is at most a short summary without the verdict lines.
	const handback = (message: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "SubagentHandback", input: { message } }] } });
	const toolResult = (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text }] }] } });
	const coordinator = (text: string) => ({ type: "user", message: { role: "user", content: text }, origin: { kind: "coordinator" } });
	const tools = { type: "attachment", attachment: { type: "deferred_tools", tools: [{ name: "SubagentHandback" }] } };
	const deliveredResult = toolResult(JSON.stringify({ success: true, message: "Report delivered to your caller." }));
	const queued = (prompt: string) => ({ type: "attachment", attachment: { type: "queued_command", prompt } });
	const transcript = (...entries: object[]) => {
		const path = join(mkdtempSync(join(tmpdir(), "hooks-tx-")), "agent.jsonl");
		writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
		return path;
	};
	let run = 0;
	const stop = (agent_transcript_path: string, last_assistant_message = "I've sent the review to the parent agent.") =>
		handle({ session_id: "s", cwd: projectDir, hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message, agent_transcript_path, prompt_id: `p${++run}`, agent_id: "a1" }, env);
	const verdict = (word: string) => `### Verdict\nReviewed BASE: ${git("rev-parse", "main")}\nReviewed HEAD: ${head}\nReady to merge: ${word}`;
	const latest = () => readReviews(projectDir, env.reviewsRoot)[0]?.verdict;
	const pr = () => decision(handle({ session_id: "s", cwd: projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }, env));

	assert.deepEqual(stop(transcript(tools, handback("Draft, no verdict yet."), deliveredResult, handback(verdict("Yes")), deliveredResult, tools)), {}, "the run's last hand-back is the report, its own tool result doesn't end the run");
	assert.equal(latest(), "Yes");
	assert.equal(pr(), undefined);

	assert.deepEqual(stop(transcript(handback(verdict("No"))), verdict("Yes")), {}, "the delivered hand-back wins over a later message");
	assert.equal(latest(), "No");

	const delivered = stop(transcript(handback(`Reviewed HEAD: ${head}\nLooks fine.`)));
	assert.equal(delivered.output, undefined, "the report is already delivered, so sending the reviewer back can't fix it");
	assert.match(String(delivered.warning), /no verdict recorded/);
	assert.equal(latest(), "Inconclusive");
	assert.equal(pr(), "deny");

	const quoted = JSON.stringify(handback(verdict("Yes")));
	const sentBack = stop(transcript(tools, toolResult(quoted), handback(verdict("Yes")), coordinator(`Round 2. Earlier: ${quoted}`), toolResult(quoted)));
	assert.equal(sentBack.output?.decision, "block", "a continued run hands back afresh: an earlier run's hand-back, or one it only read, doesn't count");
	assert.equal(stop(transcript(handback(verdict("Yes")), deliveredResult, queued("Also check X."))).output?.decision, "block", "a message queued while the reviewer worked starts a new run too");
	assert.equal(latest(), "Inconclusive");
	for (const incoming of [queued("<task-notification>done</task-notification>"), coordinator("Round 2.")]) {
		assert.deepEqual(stop(transcript(handback(verdict("Yes")), deliveredResult, incoming, handback(verdict("No")), deliveredResult)), {}, "the new run's hand-back is the report");
		assert.equal(latest(), "No");
	}
});

test("review-log prints the stored reports of a commit's latest round; with none it exits 1", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const head = git("rev-parse", "HEAD");
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
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
		assert.match(printed.stdout, /^Round 2 since the last Yes \(the stop rule counts these\)\. Earlier rounds, newest first: [0-9a-f]{7}\.\.[0-9a-f]{7} No\.$/m);
		assert.match(printed.stdout, /^Highest finding IDs so far: none; a new finding takes the next number\.$/m);
		assert.match(printed.stdout, /## Reviewer run a1 — No/);
		assert.match(printed.stdout, /`a\.ts:1` · any input · wrong total/);
	}
	// A failed run records no range and no report: review-log still prints the round and a placeholder.
	writeFileSync(join(projectDir, "b.ts"), "export const b = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: b");
	const failed = git("rev-parse", "HEAD");
	recordVerdict(projectDir, failed, "Inconclusive", { promptId: "p2", run: "a2" }, env.reviewsRoot);
	const afterFail = spawnSync(process.execPath, [join(root, "scripts", "review-log.ts"), failed], { cwd: projectDir, encoding: "utf8", env: { ...shellEnv, ENG_KIT_REVIEWS_ROOT: env.reviewsRoot } });
	assert.equal(afterFail.status, 0, afterFail.stderr);
	assert.match(afterFail.stdout, new RegExp(`^Round 2 since the last Yes \\(the stop rule counts these\\)\\. Earlier rounds, newest first: ${failed.slice(0, 7)} Inconclusive\\.$`, "m"));
	assert.match(afterFail.stdout, /\(no report stored for this run\)/);
});

/** `setupWorkspace` with its own record store, and each repository's HEAD. */
function reviewWorkspace() {
	const ctx = setupWorkspace();
	ctx.env.reviewsRoot = temp("hooks-reviews-");
	const head = (repo: string) => String(ctx.git(repo, "rev-parse", "HEAD")).trim();
	return { ...ctx, reviewsRoot: ctx.env.reviewsRoot, head };
}

test("review gate: SubagentStop records a workspace reviewer's verdict in the repository that has the commit", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	const report = `### Verdict\nReviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: Yes`;
	assert.deepEqual(call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: report, prompt_id: "p1", agent_id: "a1" }), {});
	assert.deepEqual(readReviews(join(projectDir, "a"), reviewsRoot).map((r) => [r.sha, r.verdict]), [[head("a"), "Yes"]]);
});

test("review gate: a malformed report in a workspace lands Inconclusive on each repository's HEAD", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed HEAD: deadbeef0", prompt_id: "p1", agent_id: "a1", stop_hook_active: true });
	for (const repo of ["a", "b"]) assert.deepEqual(readReviews(join(projectDir, repo), reviewsRoot).map((r) => [r.sha, r.verdict]), [[head(repo), "Inconclusive"]], repo);
});

test("review gate: a verdict short of Yes that misses a workspace repository warns without sending the reviewer back", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	assert.equal(spawnSync("git", ["clone", "-q", join(projectDir, "a"), join(projectDir, "c")]).status, 0);
	writeFileSync(reviewsDir(join(projectDir, "a"), reviewsRoot), "not a folder");
	const out = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `F1 the finding\nReviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: No`, prompt_id: "p1", agent_id: "r1" });
	assert.equal(out.output, undefined, "its lines were fine");
	assert.match(String(out.warning), /could not be recorded in every repository/);
	assert.ok(readReports(join(projectDir, "c"), head("a"), reviewsRoot).some((r) => /F1 the finding/.test(r.report)), "the reviewer's record keeps its report");
});

test("review gate: a verdict short of Yes that misses a workspace repository is followed by an Inconclusive that holds the commit back", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	assert.equal(spawnSync("git", ["clone", "-q", join(projectDir, "a"), join(projectDir, "c")]).status, 0);
	writeFileSync(reviewsDir(join(projectDir, "a"), reviewsRoot), "not a folder");
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: No`, prompt_id: "p1", agent_id: "r1" });
	assert.deepEqual(readReports(join(projectDir, "c"), head("a"), reviewsRoot).map((r) => [r.run, r.verdict]).sort(), [["r1", "No"], ["r1-held", "Inconclusive"]]);
});

test("review gate: a hold-back after a missed workspace repository leaves unrelated repositories' verdicts alone", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	assert.equal(spawnSync("git", ["clone", "-q", join(projectDir, "a"), join(projectDir, "c")]).status, 0);
	writeFileSync(reviewsDir(join(projectDir, "a"), reviewsRoot), "not a folder");
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: No`, prompt_id: "p1", agent_id: "r1" });
	assert.deepEqual(readReviews(join(projectDir, "b"), reviewsRoot), []);
});

test("review gate: a review of unverified edits with a bad BASE holds back the commit it names, not HEAD", () => {
	const { call, projectDir, reviewsRoot, head, git } = reviewWorkspace();
	const named = head("a");
	writeFileSync(join(projectDir, "a", "g.ts"), "export {};\n");
	git("a", "add", "g.ts");
	git("a", "commit", "-q", "-m", "g");
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "f.ts") } });
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: deadbeef0\nReviewed HEAD: ${named}\nReady to merge: Yes`, prompt_id: "p1", agent_id: "r1" });
	assert.deepEqual(readReviews(join(projectDir, "a"), reviewsRoot).map((r) => [r.sha, r.verdict]), [[named, "Inconclusive"]]);
});

test("review gate: a review of unverified edits that misses a workspace repository is held back there too", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	assert.equal(spawnSync("git", ["clone", "-q", join(projectDir, "a"), join(projectDir, "c")]).status, 0);
	writeFileSync(reviewsDir(join(projectDir, "a"), reviewsRoot), "not a folder");
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "b", "f.ts") } });
	const out = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: Yes`, prompt_id: "p1", agent_id: "r1" });
	assert.deepEqual(readReports(join(projectDir, "c"), head("a"), reviewsRoot).map((r) => [r.run, r.verdict]).sort(), [["r1", "Inconclusive"], ["r1-held", "Inconclusive"]]);
	assert.match(String(out.warning), /could not be recorded/);
});

test("review gate: with a workspace repository that keeps hanging, SubagentStop ends in time and warns", () => {
	const { call, projectDir, head } = reviewWorkspace();
	assert.equal(spawnSync("git", ["clone", "-q", join(projectDir, "a"), join(projectDir, "c")]).status, 0);
	const slow = slowGit(realpathSync(join(projectDir, "c")), "rev-parse", 20);
	try {
		const started = Date.now();
		const out = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `Reviewed BASE: ${head("a")}\nReviewed HEAD: ${head("a")}\nReady to merge: No`, prompt_id: "p1", agent_id: "r1" });
		assert.ok(Date.now() - started < 9500, `took ${Date.now() - started} ms, past the hook's 10 s`);
		assert.match(String(out.warning), /could not be recorded/);
	} finally {
		slow.restore();
	}
});

test("review gate: a review of unverified edits whose commit a hanging repository can't be searched for holds each HEAD back in time", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "f.ts") } });
	const slow = slowGit(realpathSync(join(projectDir, "b")), "deadbee", 20);
	try {
		const started = Date.now();
		const out = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed BASE: deadbeef0\nReviewed HEAD: deadbeef1\nReady to merge: Yes", prompt_id: "p1", agent_id: "r1" });
		assert.ok(Date.now() - started < 9500, `took ${Date.now() - started} ms, past the hook's 10 s`);
		assert.match(String(out.warning), /in time/);
	} finally {
		slow.restore();
	}
	for (const repo of ["a", "b"]) assert.deepEqual(readReviews(join(projectDir, repo), reviewsRoot).map((r) => [r.sha, r.verdict]), [[head(repo), "Inconclusive"]], repo);
});

test("SubagentStop: a hanging branch lookup for the token ledger doesn't cost the review gate its time", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "f.ts") } });
	// One repository hangs on every lookup of the gate, which so takes its whole deadline, and on the ledger's branch.
	const slow = slowGit(realpathSync(join(projectDir, "b")), ["deadbee", "HEAD^{commit}", "branch --show-current"], 20);
	try {
		const started = Date.now();
		const out = call({ hook_event_name: "SubagentStop", cwd: join(projectDir, "b"), agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed BASE: deadbeef0\nReviewed HEAD: deadbeef1\nReady to merge: Yes", prompt_id: "p1", agent_id: "r1" });
		assert.ok(Date.now() - started < 9500, `took ${Date.now() - started} ms, past the hook's 10 s`);
		assert.match(String(out.warning), /in time/);
	} finally {
		slow.restore();
	}
	assert.deepEqual(readReviews(join(projectDir, "a"), reviewsRoot).map((r) => [r.sha, r.verdict]), [[head("a"), "Inconclusive"]]);
});

test("review gate: a review of unverified edits that names no commit here falls back to each repository's HEAD", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	call({ hook_event_name: "SessionStart", source: "startup" });
	call({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(projectDir, "a", "f.ts") } });
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: "Reviewed BASE: deadbeef0\nReviewed HEAD: deadbeef1\nReady to merge: Yes", prompt_id: "p1", agent_id: "r1" });
	for (const repo of ["a", "b"]) assert.deepEqual(readReviews(join(projectDir, repo), reviewsRoot).map((r) => [r.sha, r.verdict]), [[head(repo), "Inconclusive"]], repo);
});

test("review-log reads a short SHA as the commit it abbreviates, never a branch of that name", () => {
	const { call, projectDir, reviewsRoot, head, git } = reviewWorkspace();
	const first = head("a");
	writeFileSync(join(projectDir, "a", "g.ts"), "export {};\n");
	git("a", "add", "g.ts");
	git("a", "commit", "-q", "-m", "g");
	const second = head("a");
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: `WRONG-COMMIT\nReviewed BASE: ${first}\nReviewed HEAD: ${second}\nReady to merge: No`, prompt_id: "p1", agent_id: "r1" });
	git("a", "branch", first.slice(0, 10), second);
	const { CLAUDE_PROJECT_DIR: _unset, ...shellEnv } = process.env;
	const printed = spawnSync(process.execPath, [join(root, "scripts", "review-log.ts"), first.slice(0, 10)], { cwd: join(projectDir, "a"), encoding: "utf8", env: { ...shellEnv, ENG_KIT_REVIEWS_ROOT: reviewsRoot } });
	assert.doesNotMatch(printed.stdout, /WRONG-COMMIT/);
	assert.equal(printed.status, 1);
});

test("review-log finds the commit's repository from the workspace folder", () => {
	const { call, projectDir, reviewsRoot, head } = reviewWorkspace();
	const report = `### Verdict\nReviewed BASE: ${head("b")}\nReviewed HEAD: ${head("b")}\nReady to merge: No`;
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", last_assistant_message: report, prompt_id: "p1", agent_id: "r1" });
	const { CLAUDE_PROJECT_DIR: _unset, ...shellEnv } = process.env;
	const printed = spawnSync(process.execPath, [join(root, "scripts", "review-log.ts"), head("b")], { cwd: projectDir, encoding: "utf8", env: { ...shellEnv, ENG_KIT_REVIEWS_ROOT: reviewsRoot } });
	assert.equal(printed.status, 0, printed.stderr);
	assert.match(printed.stdout, /## Reviewer run r1 — No/);
});

test("review gate: a successful gh pr create registers its branch for the push gate; a failed one does not", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("remote", "add", "origin", remote);
	git("push", "-q", "origin", "main");
	git("switch", "-qc", "feat/a");
	writeFileSync(join(projectDir, "a.ts"), "export const a = 1;\n");
	git("add", "-A");
	git("commit", "-qm", "feat: a");
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
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
	const env = (input: HookInput): HookEnv => ({ root, projectDir: input.cwd ?? tmpdir(), stateDir: temp("hooks-state-") });
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

test("guard: the implementer's own-branch push asks; the main agent's passes", () => {
	const projectDir = gitRepo({});
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" }).stdout.trim();
	const remote = temp("hooks-remote-");
	spawnSync("git", ["init", "-q", "--bare", "-b", "main"], { cwd: remote });
	git("remote", "add", "origin", remote);
	git("push", "-q", "origin", "main");
	git("switch", "-qc", "feat/a");
	const env: HookEnv = { root, projectDir, stateDir: temp("hooks-state-"), reviewsRoot: temp("hooks-reviews-") };
	const pre = (command: string, agent_type?: string) => decision(handle({ session_id: "s", cwd: projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, agent_type }, env));
	assert.equal(pre("git push"), undefined, "the main agent pushes its work branch");
	for (const agent of ["eng-kit:implementer", "implementer"]) {
		assert.equal(pre("git push", agent), "ask", agent);
		assert.equal(pre("git push -u origin feat/a 2>&1", agent), "ask", agent);
	}
	assert.equal(pre("git status", "eng-kit:implementer"), undefined, "the implementer's other git calls are untouched");
	const reason = (handle({ session_id: "s", cwd: projectDir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push" }, agent_type: "eng-kit:implementer" }, env).output!.hookSpecificOutput as Record<string, string>).permissionDecisionReason;
	assert.match(String(reason), /implementer doesn't push; the coordinator does after review/);
});

test("token ledger: a reviewer's tokens are recorded on every SubagentStop path, sent back or not", () => {
	const { env, call, projectDir } = setup();
	env.usageRoot = mkdtempSync(join(tmpdir(), "hooks-usage-"));
	spawnSync("git", ["init", "-q", "-b", "feat/r"], { cwd: projectDir });
	const transcript = (input: number) => {
		const path = join(mkdtempSync(join(tmpdir(), "hooks-tx-")), "t.jsonl");
		writeFileSync(path, JSON.stringify({ type: "assistant", message: { id: "m1", model: "m", usage: { input_tokens: input, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }));
		return path;
	};
	const sentBack = call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", agent_id: "r1", agent_transcript_path: transcript(9), last_assistant_message: "no verdict lines" });
	assert.equal((sentBack.output as { decision?: string } | undefined)?.decision, "block");
	call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:reviewer", agent_id: "r2", agent_transcript_path: transcript(19), last_assistant_message: "no verdict lines", stop_hook_active: true });
	assert.deepEqual(branchSummary(projectDir, "feat/r", env.usageRoot).byAgent, { reviewer: 30 });
});

test("token ledger: SubagentStop records the subagent's tokens and Stop the session's, on the branch of the folder the work runs in", () => {
	const { env, call, projectDir } = setup();
	env.usageRoot = mkdtempSync(join(tmpdir(), "hooks-usage-"));
	const git = (...args: string[]) => spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
	git("init", "-q", "-b", "feat/u");
	git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
	const wt = join(projectDir, ".worktrees", "w");
	git("worktree", "add", "-q", "-b", "feat/w", wt);
	const transcript = (input: number) => {
		const path = join(mkdtempSync(join(tmpdir(), "hooks-tx-")), "t.jsonl");
		writeFileSync(path, JSON.stringify({ type: "assistant", message: { id: "m1", model: "m", usage: { input_tokens: input, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }));
		return path;
	};
	assert.deepEqual(call({ hook_event_name: "SubagentStop", agent_type: "eng-kit:implementer", agent_id: "a1", agent_transcript_path: transcript(99) }), {});
	call({ hook_event_name: "Stop", transcript_path: transcript(9) });
	call({ hook_event_name: "Stop", transcript_path: transcript(19), cwd: wt });
	assert.deepEqual(call({ hook_event_name: "SubagentStop", agent_type: "Explore", agent_id: "a2", agent_transcript_path: join(tmpdir(), "no-such.jsonl") }), {});
	assert.deepEqual(branchSummary(projectDir, "feat/u", env.usageRoot), { byAgent: { implementer: 100, main: 10 }, subagents: 100, total: 110 });
	assert.deepEqual(branchSummary(projectDir, "feat/w", env.usageRoot), { byAgent: { main: 10 }, subagents: 0, total: 10 }, "work in a worktree counts on its branch, and only what it added");
	const other = mkdtempSync(join(tmpdir(), "hooks-other-repo-"));
	spawnSync("git", ["init", "-q", "-b", "feat/o"], { cwd: other });
	call({ hook_event_name: "SubagentStop", agent_type: "Explore", agent_id: "a3", agent_transcript_path: transcript(49), cwd: other });
	assert.deepEqual(branchSummary(other, "feat/o", env.usageRoot), { byAgent: { Explore: 50 }, subagents: 50, total: 50 }, "work in another repository goes to that repository's ledger, where its status line reads it");
	call({ hook_event_name: "Stop", transcript_path: transcript(29), cwd: other });
	assert.equal(branchSummary(other, "feat/o", env.usageRoot).byAgent.main, 10, "the session moved to another repository: only what it added there");
});
