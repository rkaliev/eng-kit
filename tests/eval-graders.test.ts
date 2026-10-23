import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evals = join(resolve(import.meta.dirname, ".."), "evals");

/** A regex grader's pattern, compiled as `claude plugin eval` does: `new RegExp(pattern, flags)`, flags "" by default. */
function grader(path: string): RegExp {
	const text = readFileSync(join(evals, path), "utf8");
	const match = /^pattern: '((?:[^']|'')*)'$/m.exec(text);
	assert.ok(match, `${path}: no single-quoted pattern`);
	const flagsLine = /^flags:.*$/m.exec(text)?.[0];
	const flags = flagsLine === undefined ? "" : /^flags: '([a-z]*)'$/.exec(flagsLine)?.[1];
	assert.ok(flags !== undefined, `${path}: flags must be single-quoted (${flagsLine})`);
	return new RegExp(match[1]!.replaceAll("''", "'"), flags);
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

test("spec-timeout: the timeout grader wants 2 s exactly", () => {
	const g = grader("spec-timeout/graders/timeout-2000.md");
	for (const yes of ["setTimeout(fail, 2000)", "const TIMEOUT_MS = 2_000;", "2 * 1000", "AbortSignal.timeout(2e3)"]) assert.match(yes, g, yes);
	for (const no of ["setTimeout(fail, 20000)", "12000", "12 * 1000", "2000ms"]) assert.doesNotMatch(no, g, no);
});

test("review-feedback: a review body's items get one numbered reply", () => {
	const g = grader("review-feedback/graders/body-numbered.md");
	const one = "## Review body — one top-level reply\n1. **Idempotency** — already handled in routes.ts.\n2. **Capitalisation** — fixed.\n3. **Voided payment** — test added.\n";
	const quoted = "> 1. Not changed: routes.ts replays by key.\n> 2. Fixed.\n> 3. Test added.";
	const separate = "## 2. Review body item 1 — top-level comment\nNot changed.\n## 3. Review body item 2 — top-level comment\nFixed.\n## 4. Review body item 3\nAdded.";
	const boldHeadings = "**1. Inline thread**\nFixed.\n\n**2. Review body item 1 — top-level comment**\nNot changed.\n\n**3. Review body item 2 — top-level comment**\nFixed.";
	const plainHeadings = "1. Inline thread on refunds.ts\n\nFixed: now `>`.\n\n2. Review body item 1, top-level\n\nNot changed.\n\n3. Review body item 2, top-level\n\nFixed.";
	assert.match(one, g);
	assert.match(quoted, g);
	for (const split of [separate, boldHeadings, plainHeadings]) assert.doesNotMatch(split, g, split);
});

test("review-feedback: no reply opens with praise or a concession", () => {
	const g = grader("review-feedback/graders/no-concession-opener.md");
	const praise = ["Good catch, fixed: the check is now `>`.", "Thanks, I've added the flag note.", "Thank you, added.", "You're absolutely right! Fixed.", "Great point.", "Nice catch — fixed.", "2. Good catch, fixed.", "- Thanks, fixed", "> **Great catch**, fixed."];
	const bareAgreement = ["> Agreed, will look.", "You're right.", "Fair point; leaving it for now as discussed", "You're right, this will be fixed in a follow-up.", "Agreed, not changed."];
	const afterLabel = ["2. **Capitalisation (nit):** Good catch, fixed.", "**1.** Thanks, fixed"];
	for (const opener of [...praise, ...bareAgreement, ...afterLabel]) assert.match(`## Inline\n${opener}\n`, g, opener);
	// Agreement is allowed in a reply that names the fix (receiving-code-review, Tone).
	for (const fine of ["Fixed: the check is now `>`.", "Not changed: routes.ts already replays by key.", "1. Idempotency — not changed.", "Done; we agreed with dana to note the flag.", "Agreed. Fixed: refunds.ts:19 now uses `>`.", "You're right, fixed in a7b8c9d."]) assert.doesNotMatch(`## Inline\n${fine}\n`, g, fine);
});

test("review-feedback: the claimed changes are checked in the files", () => {
	const flag = grader("review-feedback/graders/flag-noted.md");
	assert.match("## Notes\nNeeds the `refunds_v2` flag on.\n", flag);
	assert.doesNotMatch("## Notes\nAdds partial refunds.\n", flag);
	const voided = grader("review-feedback/graders/voided-test-added.md");
	assert.doesNotMatch(readFileSync(join(evals, "review-feedback/fixture/src/refunds.test.ts"), "utf8"), voided, "the fixture's test file has no voided test yet");
	assert.match('test("rejects a refund on a voided payment", () => assert.throws(() => refund({ ...captured, status: "voided" }, 1), RefundError));', voided);
});


test("docs-language: Cyrillic in the decision record fails", () => {
	const g = grader("docs-language/graders/adr-english.md");
	for (const russian of ["# 0002. Очередь сообщений\n", "Выбрали RabbitMQ", "docs: запись решения ё\n", "ё"]) assert.match(russian, g, russian);
	for (const english of ["# 0002. Message queue\n\nWe chose RabbitMQ.\n", "docs: record the message queue decision\n"]) assert.doesNotMatch(english, g, english);
});

// Reflog lines in the shape git writes them to .git/logs/HEAD.
const reflog = (who: string, entry: string) => `${"0".repeat(40)} ${"a".repeat(40)} ${who} 1700000000 +0000\t${entry}\n`;
const INITIAL = reflog("eval <eval@example.invalid>", "commit (initial): initial");

test("docs-language: Cyrillic in any commit subject fails, not in the author's name", () => {
	const g = grader("docs-language/graders/commit-english.md");
	assert.match(INITIAL + reflog("eval <e@x>", "commit: docs: запись решения"), g);
	assert.match(INITIAL + reflog("eval <e@x>", "commit: docs: record the decision") + reflog("eval <e@x>", "commit (amend): docs: запись"), g);
	assert.doesNotMatch(INITIAL + reflog("Руслан <r@x>", "commit: docs: record the message queue decision"), g);
});

test("docs-language: the requested client note is in Russian", () => {
	const g = grader("docs-language/graders/client-doc-russian.md");
	assert.match("# Очередь\n\nНичего не теряется при перезапуске.\n", g);
	assert.doesNotMatch("# Queue\n\nNothing is lost on a restart (RabbitMQ).\n", g);
});

test("docs-language: a commit counts only when git recorded one after the scaffold's", () => {
	const g = grader("docs-language/graders/commit-made.md");
	assert.doesNotMatch(INITIAL, g, "only the scaffold commit");
	assert.match(INITIAL + reflog("eval <e@x>", "commit: docs: record the message queue decision"), g);
	assert.match(INITIAL + reflog("eval <e@x>", "commit: initial work on the queue"), g);
});
