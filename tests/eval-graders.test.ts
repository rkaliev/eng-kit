import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evals = join(resolve(import.meta.dirname, ".."), "evals");

/** A regex grader's pattern, compiled as `claude plugin eval` does: `new RegExp(pattern, flags)`, flags "" by default. */
function grader(path: string): RegExp {
	const match = /^pattern: '((?:[^']|'')*)'$/m.exec(readFileSync(join(evals, path), "utf8"));
	assert.ok(match, `${path}: no single-quoted pattern`);
	return new RegExp(match[1]!.replaceAll("''", "'"), "");
}

// Trace lines in the shape Claude Code writes them: one JSON object per line.
const use = (name: string, input: object) =>
	JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name, input }] } });
const write = (path: string, content: string) => use("Write", { file_path: `/w/${path}`, content });
const edit = (path: string) => use("Edit", { replace_all: false, file_path: `/w/${path}`, old_string: "a", new_string: "b" });
const bash = (command: string) => use("Bash", { command });
const result = (text: string) =>
	JSON.stringify({ type: "user", message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: text }] } });
const trace = (...lines: string[]) => lines.join("\n");

const STUB = "export function applyPercentDiscount(totalMinor: number, percent: number): number {\n\treturn -1;\n}\n";
const IMPL = "export function applyPercentDiscount(t: number, p: number): number {\n\tif (p < 0) throw new RangeError(`bad: ${p}`);\n\treturn t;\n}\n";
const TEST = 'import { applyPercentDiscount } from "./discount.ts";\ntest("rejects", () => assert.throws(() => applyPercentDiscount(1, -1), RangeError));\n';
const RED = "✖ applies 10% (0.8ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n-1 !== 900\n";
const RED_FILTERED = "✖ applies 10% (0.8ms)\n✖ rounds half-up (0.1ms)\n";
const NO_MODULE = "✖ src/discount.test.ts (2ms)\n  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/w/src/discount.ts'\n✖ failing tests:\n";
const GREEN = "ℹ pass 8\nℹ fail 0\n";

test("red-before-green: a red run against a stub, then the code, passes", () => {
	const re = grader("tdd-discount/graders/red-before-green.md");
	assert.match(trace(write("src/discount.ts", STUB), write("src/discount.test.ts", TEST), result(RED), write("src/discount.ts", IMPL)), re);
	assert.match(trace(write("src/discount.test.ts", TEST), write("src/discount.ts", STUB), result(RED_FILTERED), edit("src/discount.ts")), re);
	const heredoc = `cat > src/discount.ts <<'EOF'\n${STUB}EOF\ncat > src/discount.test.ts <<'EOF'\n${TEST}EOF\nnpm test`;
	assert.match(trace(bash(heredoc), result(RED), bash(`cat <<'EOF' > src/discount.ts\n${IMPL}EOF`)), re);
	assert.match(trace(write("src/discount.ts", STUB), result(RED), bash(`tee src/discount.ts <<'EOF'\n${IMPL}EOF`)), re);
});

test("red-before-green: a missing module is not red, and code first fails", () => {
	const re = grader("tdd-discount/graders/red-before-green.md");
	assert.doesNotMatch(trace(write("src/discount.test.ts", TEST), result(NO_MODULE), write("src/discount.ts", IMPL), result(GREEN)), re);
	assert.doesNotMatch(trace(write("src/discount.ts", IMPL), write("src/discount.test.ts", TEST), result(GREEN)), re);
	assert.doesNotMatch(trace(write("src/discount.ts", IMPL), write("src/discount.test.ts", TEST), result(RED), edit("src/discount.ts")), re);
	assert.doesNotMatch(trace(bash(`cat > src/discount.ts <<'EOF'\n${IMPL}EOF`), result(RED), edit("src/discount.ts")), re);
	const noSpec = "✖ src/discount.spec.ts (2ms)\n  Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n";
	assert.doesNotMatch(trace(write("src/discount.spec.ts", TEST), result(noSpec), write("src/discount.ts", IMPL)), re);
});

test("reproduced-first: a failing run before any edit of the parser", () => {
	const re = grader("bug-root-cause/graders/reproduced-first.md");
	assert.match(trace(edit("src/amount.test.ts"), result(RED), edit("src/amount.ts")), re);
	assert.match(trace(bash("cat >> src/amount.test.ts <<'EOF'\ntest()\nEOF"), result(RED_FILTERED), bash("python3 fix.py")), re);
	assert.doesNotMatch(trace(edit("src/amount.ts"), edit("src/amount.test.ts"), result(RED)), re);
	assert.doesNotMatch(trace(bash("sed -i '' 's/parseInt/parse/' src/amount.ts"), result(RED)), re);
	assert.doesNotMatch(trace(bash(`cat > "src/amount.ts" <<'EOF'\nx\nEOF`), result(RED)), re);
	assert.doesNotMatch(trace(edit("src/amount.test.ts"), result(NO_MODULE.replaceAll("discount", "amount"))), re);
});
