import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { KIT_DIR, planInstall, projectHooks } from "../lib/install.ts";

const root = resolve(import.meta.dirname, "..");
const install = (project: string, ...args: string[]) =>
	spawnSync(process.execPath, [join(root, "scripts", "install-project.ts"), project, ...args], { encoding: "utf8" });

test("project hooks are the plugin hooks pointed at .claude/eng-kit", () => {
	const hooks = JSON.stringify(projectHooks(root));
	assert.doesNotMatch(hooks, /CLAUDE_PLUGIN_ROOT/);
	assert.match(hooks, /node \\"\$CLAUDE_PROJECT_DIR\/\.claude\/eng-kit\/hooks\/hook\.ts\\"/);
	for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "UserPromptSubmit"]) assert.ok(hooks.includes(`"${event}"`), event);
});

test("install is a dry run by default, then installs a working copy", () => {
	const project = mkdtempSync(join(tmpdir(), "install-"));
	writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

	const dry = install(project);
	assert.equal(dry.status, 0, dry.stderr);
	assert.equal(existsSync(join(project, ".claude")), false);

	const real = install(project, "--yes");
	assert.equal(real.status, 0, real.stderr);
	for (const f of [".claude/skills/using-skills/SKILL.md", ".claude/skills/implement/SKILL.md", ".claude/agents/reviewer.md", `${KIT_DIR}/hooks/hook.ts`, `${KIT_DIR}/lib/hooks.ts`, `${KIT_DIR}/scripts/verify.ts`, `${KIT_DIR}/package.json`, ".claude/verify.json"]) {
		assert.ok(existsSync(join(project, f)), f);
	}
	const settings = JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"));
	assert.ok(settings.hooks.PreToolUse);
	assert.ok(settings.permissions.deny.includes("Read(**/.env)"));

	// The installed hook runs from the project copy and finds .claude/skills.
	const hook = spawnSync(process.execPath, [join(project, KIT_DIR, "hooks", "hook.ts")], {
		input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "x", cwd: project }),
		encoding: "utf8",
		env: { ...process.env, CLAUDE_PROJECT_DIR: project },
	});
	assert.equal(hook.status, 0, hook.stderr);
	assert.match(JSON.parse(hook.stdout).hookSpecificOutput.additionalContext, /eng-kit[\\/]scripts[\\/]verify\.ts/);
});

test("re-install updates kit files, keeps project files, and does not duplicate hooks", () => {
	const project = mkdtempSync(join(tmpdir(), "reinstall-"));
	mkdirSync(join(project, ".claude/agents"), { recursive: true });
	writeFileSync(join(project, ".claude/agents/reviewer.md"), "---\nname: reviewer\ndescription: ours\n---\nOur reviewer.\n");
	assert.equal(install(project, "--yes").status, 0);
	assert.equal(readFileSync(join(project, ".claude/agents/reviewer.md"), "utf8").includes("Our reviewer."), true, "a project file is never overwritten");

	writeFileSync(join(project, ".claude/skills/verify/SKILL.md"), "stale kit copy\n");
	const plan = planInstall(root, project);
	assert.equal(plan.copies.find((c) => c.target === ".claude/skills/verify/SKILL.md")!.status, "update");
	assert.equal(plan.copies.find((c) => c.target === ".claude/agents/reviewer.md")!.status, "conflict");

	assert.equal(install(project, "--yes").status, 0);
	assert.notEqual(readFileSync(join(project, ".claude/skills/verify/SKILL.md"), "utf8"), "stale kit copy\n");
	const settings = JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"));
	assert.equal(settings.hooks.PreToolUse.length, 1, "kit hook groups are replaced, not appended");
	assert.equal(planInstall(root, project).init.find((i) => i.target === ".claude/settings.json")!.status, "exists");
});
