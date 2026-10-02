import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DEFAULT_IGNORE } from "../lib/commands.ts";
import { detectVerifyCommands, HYGIENE_TARGET, mergeAdditive, planInit, SECRET_DENY } from "../lib/init.ts";

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

test("kit-init reports whether CI runs every verification command", async () => {
	const { ciCoverage } = await import("../lib/ci.ts");
	const verify = JSON.stringify({ commands: ["npm test", "npm run typecheck"] });
	const none = project({ ".claude/verify.json": verify });
	const ciOf = (dir: string) => planInit(dir).find((i) => i.target === "CI")!;
	assert.equal(ciOf(none).status, "missing");
	assert.match(ciOf(none).why, /no CI configuration/);

	const stale = project({ ".claude/verify.json": verify, ".github/workflows/ci.yml": "jobs:\n  t:\n    steps:\n      - run: npm   test\n" });
	assert.equal(ciOf(stale).status, "missing");
	assert.match(ciOf(stale).why, /doesn't run: npm run typecheck/);
	assert.deepEqual(ciCoverage(stale, ["npm test"]).missing, [], "whitespace is normalized");

	const noDocsCheck = project({ ".claude/verify.json": verify, ".gitlab-ci.yml": "test:\n  script:\n    - npm run typecheck\n    - npm test\n" });
	assert.equal(ciOf(noDocsCheck).status, "missing");
	assert.match(ciOf(noDocsCheck).why, /working-docs check/);
	assert.doesNotMatch(ciOf(noDocsCheck).why, /doesn't run/);

	const gitlab = "test:\n  script:\n    - npm run typecheck\n    - npm test\nworking-docs:\n  script:\n    - true\n";
	const ok = project({ ".claude/verify.json": verify, ".gitlab-ci.yml": gitlab });
	assert.equal(ciOf(ok).status, "exists");
	assert.match(ciOf(ok).why, /\.gitlab-ci\.yml runs every verification command and the working-docs check/);

	const optedOut = project({ ".claude/verify.json": verify, ".claude/guard.json": JSON.stringify({ workDocs: [] }), ".gitlab-ci.yml": "test:\n  script:\n    - npm run typecheck\n    - npm test\n" });
	assert.equal(ciOf(optedOut).status, "exists", "workDocs: [] turns the check off");
});

test("test-hygiene: offered without the flag, copied with it, and an older copy is reported", () => {
	const script = 'export const VERSION = "2";\n// checker\n';
	const item = (dir: string, copy = false) => planInit(dir, { hygieneScript: script, copyHygiene: copy }).find((i) => i.target === HYGIENE_TARGET)!;
	const fresh = project({ "package.json": "{}" });
	assert.equal(item(fresh).status, "missing", "never written without the user's agreement");
	assert.match(item(fresh).why, /--test-hygiene/);
	assert.deepEqual([item(fresh, true).status, item(fresh, true).content], ["create", script]);
	assert.equal(item(project({ [HYGIENE_TARGET]: script })).status, "exists");
	const olderDir = project({ [HYGIENE_TARGET]: 'export const VERSION = "1";\n' });
	const old = item(olderDir);
	assert.equal(old.status, "missing");
	assert.match(old.why, /v1 is older than the kit's v2/);
	assert.deepEqual([item(olderDir, true).status, item(olderDir, true).content], ["merge", script], "--test-hygiene replaces an older copy");
	assert.equal(item(project({ [HYGIENE_TARGET]: 'export const VERSION = "10";\n' })).status, "exists", "a newer copy is not called older");
	assert.equal(planInit(fresh).some((i) => i.target === HYGIENE_TARGET), false, "no script, no item");

	const ci = (files: Record<string, string>) => planInit(project(files), { hygieneScript: script }).find((i) => i.target === "CI")!;
	const workflow = "jobs:\n  t:\n    steps:\n      - run: npm test\n  working-docs:\n";
	const pkg = JSON.stringify({ scripts: { test: "vitest run" } });
	assert.match(ci({ "package.json": pkg, [HYGIENE_TARGET]: script, ".github/workflows/ci.yml": workflow }).why, /doesn't run \.ci\/test-hygiene\.mts/);
	assert.equal(ci({ "package.json": pkg, [HYGIENE_TARGET]: script, ".github/workflows/ci.yml": `${workflow}      - run: node .ci/test-hygiene.mts\n` }).status, "exists");
	const sameRun = planInit(project({ "package.json": pkg, ".github/workflows/ci.yml": workflow }), { hygieneScript: script, copyHygiene: true }).find((i) => i.target === "CI")!;
	assert.match(sameRun.why, /doesn't run \.ci\/test-hygiene\.mts/, "the run that adds the script reports the CI gap");
});

test("init.ts --test-hygiene copies the kit's own script", () => {
	const dir = project({ "package.json": "{}" });
	const run = (...args: string[]) => spawnSync(process.execPath, [join(root, "scripts", "init.ts"), "--project", dir, ...args], { encoding: "utf8" });
	run("--yes");
	assert.equal(existsSync(join(dir, HYGIENE_TARGET)), false);
	run("--yes", "--test-hygiene");
	assert.equal(readFileSync(join(dir, HYGIENE_TARGET), "utf8"), readFileSync(join(root, "scripts", "test-hygiene.ts"), "utf8"));
});

test("then from turbo.json tasks, as one turbo run", () => {
	const turbo = JSON.stringify({ tasks: { build: {}, lint: {}, test: {}, typecheck: {} } });
	const s = scripts({ test: "turbo run test" });
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": turbo, "pnpm-workspace.yaml": "", "package.json": s })), ["pnpm turbo run typecheck lint test"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": turbo, "package-lock.json": "{}", "package.json": s })), ["npx turbo run typecheck lint test"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": JSON.stringify({ pipeline: { test: {} } }), "yarn.lock": "", "package.json": s })), ["yarn turbo run test"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": "{", "package.json": scripts({ test: "vitest run" }) })), ["npm test"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": JSON.stringify({ tasks: { build: {} } }), "package.json": scripts({ test: "vitest run" }) })), ["npm test"]);
});

test("turbo detection edge cases", () => {
	const tasks = (t: Record<string, unknown>) => JSON.stringify({ tasks: t });
	const s = scripts({ test: "vitest run" });
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": tasks({ test: {} }), "bun.lock": "" })), ["bunx turbo run test"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": tasks({ "type-check": {}, test: {} }), "package-lock.json": "{}" })), ["npx turbo run type-check test"]);
	assert.deepEqual(detectVerifyCommands(project({ "CLAUDE.md": "## Commands\n- `make check`\n", "turbo.json": tasks({ test: {} }) })), ["make check"]);
	assert.deepEqual(detectVerifyCommands(project({ "pnpm-workspace.yaml": "", "package.json": s })), ["pnpm test"], "without turbo.json the scripts apply");
	// turbo.json and turbo.jsonc may carry comments
	const commented = '{\n// a comment\n"url": "http://x", /* block */ "tasks": {"lint": {}}\n}';
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": commented, "package-lock.json": "{}" })), ["npx turbo run lint"]);
	assert.deepEqual(detectVerifyCommands(project({ "turbo.jsonc": commented, "package-lock.json": "{}" })), ["npx turbo run lint"]);
	// package-scoped task keys
	assert.deepEqual(detectVerifyCommands(project({ "turbo.json": tasks({ "web#test": {}, "//#lint": {} }), "package-lock.json": "{}" })), ["npx turbo run lint test"]);
});
