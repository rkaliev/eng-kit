import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DEFAULT_IGNORE } from "../lib/commands.ts";
import { detectVerifyCommands, mergeAdditive, planInit, SECRET_DENY } from "../lib/init.ts";

const root = resolve(import.meta.dirname, "..");

function project(files: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "init-"));
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(resolve(dir, name, ".."), { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	return dir;
}

const scripts = (s: Record<string, string>) => JSON.stringify({ scripts: s });
const byTarget = (dir: string) => Object.fromEntries(planInit(dir).map((i) => [i.target, i]));

test("verify commands come from CLAUDE.md or AGENTS.md first", () => {
	assert.deepEqual(detectVerifyCommands(project({ "CLAUDE.md": "## Commands\n- `make check`\n", "package.json": scripts({ test: "vitest run" }) })), ["make check"]);
	assert.deepEqual(detectVerifyCommands(project({ "AGENTS.md": "## Commands\n- `make test`\n" })), ["make test"]);
});

test("then from package.json scripts, with the package manager from the lockfile", () => {
	const s = scripts({ dev: "vite", test: "vitest run", typecheck: "tsc", lint: "eslint .", build: "vite build", start: "node ." });
	assert.deepEqual(detectVerifyCommands(project({ "package.json": s, "package-lock.json": "{}" })), ["npm run typecheck", "npm run lint", "npm test", "npm run build"]);
	assert.deepEqual(detectVerifyCommands(project({ "package.json": s, "pnpm-lock.yaml": "" }))[0], "pnpm run typecheck");
	assert.deepEqual(detectVerifyCommands(project({ "package.json": scripts({ test: 'echo "Error: no test specified" && exit 1' }) })), []);
});

test("then from well-known build tools", () => {
	assert.deepEqual(detectVerifyCommands(project({ gradlew: "" })), ["./gradlew check"]);
	assert.deepEqual(detectVerifyCommands(project({ "Cargo.toml": "" })), ["cargo test"]);
	assert.deepEqual(detectVerifyCommands(project({ "go.mod": "" })), ["go vet ./...", "go test ./..."]);
	assert.deepEqual(detectVerifyCommands(project({ "App.sln": "" })), ["dotnet test"]);
	assert.deepEqual(detectVerifyCommands(project({ "pyproject.toml": "" })), ["pytest"]);
	assert.deepEqual(detectVerifyCommands(project({})), []);
});

test("planInit creates what is missing and never plans to overwrite", () => {
	const plan = byTarget(project({ "package.json": scripts({ test: "vitest run" }), ".claude/guard.json": "{}" }));
	assert.equal(plan[".claude/guard.json"]!.status, "exists");
	assert.deepEqual(JSON.parse(plan[".claude/verify.json"]!.content!), { commands: ["npm test"], timeoutSec: 600, ignore: DEFAULT_IGNORE });
	assert.deepEqual(JSON.parse(plan[".claude/settings.json"]!.content!), { permissions: { deny: SECRET_DENY } });
	assert.equal(plan["CLAUDE.md"]!.status, "missing", "CLAUDE.md is left to onboarding");
});

test("an existing AGENTS.md is imported rather than duplicated", () => {
	const plan = byTarget(project({ "AGENTS.md": "# x\n" }));
	assert.equal(plan["CLAUDE.md"]!.status, "create");
	assert.equal(plan["CLAUDE.md"]!.content, "@AGENTS.md\n");
});

test("settings are merged additively and idempotently", () => {
	const existing = { permissions: { deny: ["Read(**/.env)", "Bash(rm:*)"], allow: ["Bash(npm test)"] }, model: "opus" };
	const dir = project({ ".claude/settings.json": JSON.stringify(existing), "CLAUDE.md": "# x\n" });
	const settings = byTarget(dir)[".claude/settings.json"]!;
	assert.equal(settings.status, "merge");
	const merged = JSON.parse(settings.content!);
	assert.equal(merged.model, "opus");
	assert.deepEqual(merged.permissions.allow, ["Bash(npm test)"]);
	assert.deepEqual(merged.permissions.deny.slice(0, 2), ["Read(**/.env)", "Bash(rm:*)"]);
	assert.equal(merged.permissions.deny.filter((r: string) => r === "Read(**/.env)").length, 1, "no duplicates");

	writeFileSync(join(dir, ".claude/settings.json"), settings.content!);
	assert.equal(byTarget(dir)[".claude/settings.json"]!.status, "exists", "idempotent");
	assert.equal(byTarget(project({ ".claude/settings.json": "{ broken" }))[".claude/settings.json"]!.status, "exists", "broken JSON is left alone");
});

test("mergeAdditive keeps user scalars and adds missing array items", () => {
	assert.deepEqual(mergeAdditive({ a: 1, list: [1, 2], o: { x: 1 } }, { a: 2, list: [2, 3], o: { y: 2 }, b: true }), { a: 1, list: [1, 2, 3], o: { x: 1, y: 2 }, b: true });
});

test("init.ts is a dry run unless --yes", () => {
	const dir = project({ "package.json": scripts({ test: "node --test" }) });
	const dry = spawnSync(process.execPath, [join(root, "scripts", "init.ts"), "--project", dir], { encoding: "utf8" });
	assert.equal(dry.status, 0, dry.stderr);
	assert.match(dry.stdout, /dry run/);
	assert.equal(existsSync(join(dir, ".claude")), false);

	const real = spawnSync(process.execPath, [join(root, "scripts", "init.ts"), "--project", dir, "--yes"], { encoding: "utf8" });
	assert.equal(real.status, 0, real.stderr);
	assert.deepEqual(JSON.parse(readFileSync(join(dir, ".claude/verify.json"), "utf8")).commands, ["npm test"]);
	assert.match(real.stdout, /onboarding-existing-codebase/);
});
