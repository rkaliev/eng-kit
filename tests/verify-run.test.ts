import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { readRun } from "../lib/state.ts";
import { parseVerifyArgs, runVerification } from "../lib/verify-run.ts";

const made: string[] = [];
after(() => {
	for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
function project(config: object): string {
	const dir = mkdtempSync(join(tmpdir(), "verify-run-"));
	made.push(dir);
	mkdirSync(join(dir, ".claude"));
	writeFileSync(join(dir, ".claude", "verify.json"), JSON.stringify(config));
	return dir;
}
/** A runner that passes every command and remembers the order it ran them in. */
function recorder() {
	const ran: string[] = [];
	return { ran, run: (command: string) => (ran.push(command), { code: 0, timedOut: false, output: "" }) };
}

test("parseVerifyArgs: --only pairs, then an optional project folder", () => {
	assert.deepEqual(parseVerifyArgs(["--only", "a", "--only", "c"]), { only: ["a", "c"] });
	assert.deepEqual(parseVerifyArgs(["/p"]), { only: [], dir: "/p" });
	assert.deepEqual(parseVerifyArgs(["--only", "a", "/p"]), { only: ["a"], dir: "/p" });
	assert.equal(parseVerifyArgs(["--only"]).error, "--only needs a command");
});

test("runVerification with only runs those commands in config order and reports only them", () => {
	const { ran, run } = recorder();
	const r = runVerification(project({ commands: ["a", "b", "c"] }), run, ["c", "a"]);
	assert.deepEqual(ran, ["a", "c"]);
	assert.deepEqual(r.commands, ["a", "c"]);
	assert.equal(r.ok, true);
	assert.equal(r.exitCode, 0);
	assert.doesNotMatch(r.report, /\bb\b/);
	assert.match(r.report, /^Verification \(\.claude\/verify\.json, --only: 2 of 3\): selected checks passed$/m, "a subset doesn't claim all checks");
});

test("runVerification with an unknown --only command runs nothing and exits 2", () => {
	const { ran, run } = recorder();
	const r = runVerification(project({ commands: ["a", "b"] }), run, ["zz"]);
	assert.deepEqual(ran, []);
	assert.equal(r.ok, false);
	assert.equal(r.exitCode, 2);
	assert.match(r.report, /--only "zz" is not one of the verification commands/);
});

test("runVerification without only runs every command and notes a bad paths entry", () => {
	const { ran, run } = recorder();
	const r = runVerification(project({ commands: ["a", "b", "c"], paths: { b: [] } }), run);
	assert.deepEqual(ran, ["a", "b", "c"]);
	assert.match(r.report, /Note: paths: "b" needs a non-empty list of globs/);
});

test("verify script: --only records just the commands it ran; an unknown one exits 2 and records nothing", () => {
	const script = resolve(import.meta.dirname, "..", "scripts", "verify.ts");
	const dir = project({ commands: ["node -e 0", "node -e 1"] });
	const tmp = mkdtempSync(join(tmpdir(), "verify-run-tmp-"));
	made.push(tmp);
	const runs = join(tmp, "eng-kit", "runs");
	const verify = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, CLAUDE_PROJECT_DIR: dir } });

	const unknown = verify("--only", "npm test");
	assert.equal(unknown.status, 2);
	assert.match(unknown.stdout, /--only "npm test" is not one of the verification commands/);
	assert.equal(readRun(dir, runs), undefined);

	const subset = verify("--only", "node -e 0");
	assert.equal(subset.status, 0, subset.stdout);
	assert.deepEqual(readRun(dir, runs)?.commands, ["node -e 0"]);
});
