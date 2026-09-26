import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commandMatches, DEFAULT_IGNORE, isIgnored, parseAgentsCommands, resolveIgnore, resolveVerifyCommands } from "../lib/commands.ts";

test("parses verification commands from an AGENTS.md Commands section", () => {
	const md = `# App

## Структура
- src/lib — logic

## Команды
- npm test — тесты (vitest run)
- npm run typecheck — проверка типов (tsc --noEmit)
- npm run dev — dev-сервер. Не запускай: он уже открыт

## Правила
- npm run lint is not in the commands section
`;
	assert.deepEqual(parseAgentsCommands(md), ["npm test", "npm run typecheck"]);
});

test("prefers backticked commands and skips long-running ones", () => {
	const md = `## Commands
- Test: \`pnpm vitest run\`
- Lint: \`pnpm lint\`
- Build: \`./gradlew assembleDebug\`
- Serve: \`pnpm start\`
- \`cargo watch -x test\`
`;
	assert.deepEqual(parseAgentsCommands(md), ["pnpm vitest run", "pnpm lint", "./gradlew assembleDebug"]);
});

test("returns nothing when there is no commands section", () => {
	assert.deepEqual(parseAgentsCommands("# Title\n\n- npm test\n"), []);
});

test(".claude/verify.json wins over CLAUDE.md, which wins over AGENTS.md", () => {
	const dir = mkdtempSync(join(tmpdir(), "verify-"));
	writeFileSync(join(dir, "AGENTS.md"), "## Commands\n- `npm test`\n");
	assert.deepEqual(resolveVerifyCommands(dir), { commands: ["npm test"], source: "AGENTS.md" });

	writeFileSync(join(dir, "CLAUDE.md"), "## Commands\n- `pnpm test`\n");
	assert.deepEqual(resolveVerifyCommands(dir), { commands: ["pnpm test"], source: "CLAUDE.md" });

	mkdirSync(join(dir, ".claude"));
	writeFileSync(join(dir, ".claude", "verify.json"), JSON.stringify({ commands: ["make check"] }));
	assert.deepEqual(resolveVerifyCommands(dir), { commands: ["make check"], source: ".claude/verify.json" });
});

test("a bash call proves a verification command only when it runs it exactly and keeps its exit code", () => {
	assert.equal(commandMatches("npm test > out.log 2>&1", "npm test"), true);
	assert.equal(commandMatches("npm test 2>&1 | tail -20", "npm test"), false, "a pipe hides the exit code");
	assert.equal(commandMatches("npm test && npm run typecheck", "npm run typecheck"), true);
	assert.equal(commandMatches("cd packages/app && npm run typecheck", "npm run typecheck"), false, "another directory proves nothing here");
	assert.equal(commandMatches("npm test -- --grep x", "npm test"), false, "filtered runs do not prove the suite");
	assert.equal(commandMatches("echo npm test", "npm test"), false);
});

test("ignore globs: defaults cover docs, verify.json can override them", () => {
	for (const p of ["README.md", "docs/specs/x.md", "a/b/notes.txt", "docs/img/x.svg", "site/page.mdx"]) assert.equal(isIgnored(p, DEFAULT_IGNORE), true, p);
	for (const p of ["src/a.ts", "docs.go", "cmd/docs/main.go"]) assert.equal(isIgnored(p, DEFAULT_IGNORE), false, p);
	assert.equal(isIgnored("src/a.test.ts", ["src/*.ts"]), true);
	assert.equal(isIgnored("src/x/a.ts", ["src/*.ts"]), false);
	assert.equal(isIgnored("src\\gen\\api.ts", ["src/gen/**"]), true, "windows separators");

	const dir = mkdtempSync(join(tmpdir(), "ignore-"));
	assert.deepEqual(resolveIgnore(dir), DEFAULT_IGNORE);
	mkdirSync(join(dir, ".claude"));
	writeFileSync(join(dir, ".claude", "verify.json"), JSON.stringify({ commands: [], ignore: [] }));
	assert.deepEqual(resolveIgnore(dir), []);
});
