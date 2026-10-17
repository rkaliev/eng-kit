# Opus at xhigh for reasoning, code and review; evals judged by behavior

Status: in progress
Base: a9bdcba (pi: c8096a5)
Links: None

<details><summary>Original request</summary>

отлично давай поймем что дальше видимо нужен план, а так же если у нас включены адаптивные модели то я бы хотел перейти на последний опус и екстра хай везде по дефолту

мне нужно где рассуждение и написание кода, ревью была максимальная модель Opus/xhigh, во всех сотальных случаях можно оставить как есть. где не критчино и не так важно качество.

0.27.0: задачи 1+2+3+6

</details>

## Intent

Reasoning, writing code and review run on the latest Opus at xhigh while the rest stays as is; eval results stop depending on a noisy LLM judge; the "timeout set by the requirements" exception is checked automatically; writing-plans gets room under its word budget. Both editions, released as 0.27.0.

## Context

The `implementer` agent is pinned to `model: sonnet` with no effort, and code-writing skills (TDD, executing-plans, implement) run at the session's effort; only the reviewer and four reasoning skills set xhigh. `claude plugin eval` graders can't run code (regex, tool_order, tool_used, file_exists, llm, baseline), and in 0.26.0 the bug-root-cause judge passed and failed parsers that behave identically. writing-plans is at 799/800 words in pi.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | Claude: `agents/implementer.md` has `model: opus` and `effort: xhigh`; test-driven-development, executing-plans, implement, changing-legacy-code, requesting-code-review and receiving-code-review set `effort: xhigh`; no other skill's effort changes | lint (`effort` and `model` values); review of the diff |
| 2 | pi: `templates/model-routing.json` routes `implement` to `deep`; onboard, finish, docs and new-task are unchanged | review; README example matches the template |
| 3 | `scripts/eval-behavior.ts <results.json>` runs each case's `evals/<case>/behavior.ts` check on every run's final file (from a file-focused llm grader's evidence) and prints per arm how many runs had no violation; a run with no evidence is reported as such, not counted as passing | `tests/eval-behavior.test.ts` on synthetic results: a correct file → 0 violations, a wrong file → its violation, a run without evidence → "no evidence"; the check runs in a child `node` process with a timeout |
| 4 | `evals/bug-root-cause/behavior.ts` checks the parser on fixed inputs (`1,234.50`, `12.50`, `7`, `1,000,000.00` parse; `abc`, `1,2,3x`, `12x`, `1,50`, `12,34.5`, `1.2.3` throw RangeError) | the script on the kept 0.26.0 results reproduces the recorded behavior table; EVALS.md records it |
| 5 | New eval `spec-timeout`: a spec requires `fetchQuote` to fail with `QuoteTimeoutError` after 2 s; the fixture has no timeout and its test hangs. Graders: a 2000 ms timeout in `src/quote.ts`; the test file neither edited nor rewritten; a judge on `src/quote.ts`; skill loaded; `behavior.ts`: a hung provider rejects with `QuoteTimeoutError` within 2.5 s, a fast one resolves | fixture: test fails as given, passes with a reference fix (temp copy); eval run, both arms, 3 runs; behavior script on the results |
| 6 | writing-plans body ≤ 780 words in both editions, with no rule removed | lint word count; review of the diff (each removed phrase is a repeat or an aside) |
| 7 | Docs: Claude README "Models", ARCHITECTURE agent table and tree line, pi README routing example, CHANGELOG 0.27.0 in both, EVALS.md (behavior check, new case); versions 0.27.0 | `npm test`, `npm run typecheck`, `node .github/release.ts check` in both; `claude plugin validate .` |

## Scope

**In scope:**
- items 1, 2, 3 and 6 of the 0.26.0 follow-up list, in both editions (evals and agents only in the Claude edition).

**Out of scope:**
- a harder `symptom-remedy` and a review-feedback grader (next release);
- the user's personal `~/.claude/settings.json`;
- pi routing for onboard, finish, docs and new-task.

## Decisions

1. Opus at xhigh where the work is reasoning, writing code or review; everything else unchanged. (user, 2026-10-17)
2. The deterministic check is a script run after the eval on its results JSON; the llm judge stays in the score as a secondary signal. (user, 2026-10-17)
3. The release is 0.27.0 with tasks 1, 2, 3 and 6. (user, 2026-10-17)
4. The behavior check runs the agent's file in a child process with a timeout, reading the file from the results JSON; it never runs inside the eval sandbox's kept directories. **assumed**

## Design

- `evals/<case>/behavior.ts` default-exports `{ file: string, check(mod: Record<string, unknown>): Promise<string[]> }`; `file` is the path a file-focused llm grader of that case reads.
- `scripts/eval-behavior.ts <results.json> [--timeout-ms 10000]`: for each case in the results that has `evals/<name>/behavior.ts`, for each arm and run, take the evidence of the llm grader whose `focus.path` is `file`, write it to a temp dir under that path, run `node <runner> <behavior.ts> <file>` with the timeout, collect violations. Prints `case arm: K of N without violations` and each violation; exit 0.
- `spec-timeout` fixture: `src/quote.ts` exports `fetchQuote(provider: () => Promise<number>): Promise<number>` and `QuoteTimeoutError`; the reference fix races the provider with a 2000 ms timer and clears it.

## Rollout

None: released with the CI tag after merge. The implementer change raises the cost of subagent-per-task execution; CHANGELOG says so.

## Risks and open questions

- A skill's `effort: xhigh` also raises the main session's spend while it is active → limited to the six named skills.
- The behavior script imports model-written code → child process, temp dir, timeout; it reads only our own eval results.
- Trimming writing-plans drops a sentence that did work (lesson from 0.21.0) → removed phrases are listed in the review.

## Follow-ups

- A harder `symptom-remedy` (the cause outside the failing file).
- A review-feedback grader (a PR fixture with findings in a review body and a thread).

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** ship 0.27.0 with the four items above.
**Architecture:** frontmatter and template edits; one new script with a test; one new eval case; behavior checks per case; doc updates. Claude-only for agents, evals and the script; pi gets the routing template, writing-plans trim and docs.
**Stack / constraints:** Node ≥ 22.18, `node --test`, TypeScript 5.9.3 (strip-types), no dependencies; SKILL.md body ≤ 800; no commit trailers; no source-project names.
**Verification:** `npm test && npm run typecheck` in each edition; `node .github/release.ts check`; `claude plugin validate .` (Claude).

### Review focus
1. The behavior script counts a run with no evidence or a crashed import as passing.
2. A child process hangs (a never-settling promise in the agent's code) and blocks the script.
3. `effort: xhigh` lands on a skill outside the agreed set, or a domain skill changes.
4. The writing-plans trim removes a rule (Coverage, BDD outside-in, the "longer than the code" line, Base, Status).
5. The `spec-timeout` timeout regex passes code where 2000 appears but no timeout fires (a comment, an unused constant).

### Post-implementation
- CHANGELOG.md both: 0.27.0.
- package.json, plugin.json, package-lock.json (Claude); package.json, package-lock.json (pi): 0.27.0; pi README and guides pins `@v0.27.0` (the release check enforces it).
- README Claude "Models" line; ARCHITECTURE.md/.ru.md agent table and tree line; pi README routing example; EVALS.md: Cases row, behavior-check section.
- Workspace (private) FRAMEWORK-SOURCES §11.38.

### Task 1: Opus at xhigh (Claude) and routing (pi)

**Files:** Modify `src_claude/agents/implementer.md`, `src_claude/skills/{test-driven-development,executing-plans,implement,changing-legacy-code,requesting-code-review,receiving-code-review}/SKILL.md`, `src/templates/model-routing.json`, `src/README.md`

- [x] implementer: `model: opus`, add `effort: xhigh`; add `effort: xhigh` after `description:` in the six skills
- [x] pi template and README example: `"implement": "deep"`
- [x] `node --test tests/lint-skills.test.ts` both PASS; `grep -l "^effort: xhigh" skills/*/SKILL.md` lists exactly the 10 agreed skills; commit `feat(models): opus at xhigh for code and review`

### Task 2: behavior-check script

**Files:** Create `src_claude/scripts/eval-behavior.ts`, `src_claude/scripts/eval-behavior-runner.ts`, `src_claude/tests/eval-behavior.test.ts`

- [x] Write test `reports violations per run from the results file`: synthetic results JSON with one case `demo` (arms with/without, one run each with an llm grader `focus.path: src/a.ts` and evidence), a temp `evals/demo/behavior.ts` whose check expects `double(2) === 4`; with-run evidence correct, without-run returns 5 → expect `demo with: 1 of 1`, `demo without: 0 of 1` and violation `double(2) = 5`; stub `runBehavior` returns `[]` → FAIL on the counts
- [x] Add rows: a run with no evidence → `no evidence`, counted as not passing; a check that never settles → `timed out after 200 ms` with `--timeout-ms 200`
- [x] Implement `runBehavior(resultsPath, { evalsDir, timeoutMs }): Promise<Report>` and the CLI; the runner imports the behavior module and the file, prints violations as JSON
- [x] `npm test` PASS; commit `feat(evals): check final files by behavior after a run`

### Task 3: bug-root-cause behavior

**Files:** Create `src_claude/evals/bug-root-cause/behavior.ts`

- [x] Inputs and expectations from criterion 4; run `node scripts/eval-behavior.ts` on the kept 0.26.0 results (RED/GREEN JSONs in the session scratchpad) → expect the table recorded in EVALS.md (every kit run: separators right, `12x` and `1.2.3` accepted except one GREEN run)
- [x] Commit `feat(evals): bug-root-cause behavior check`

### Task 4: spec-timeout case

**Files:** Create `src_claude/evals/spec-timeout/{case.yaml,prompt.md,scaffold.sh,behavior.ts,fixture/{package.json,dot-gitignore,docs/spec.md,src/quote.ts,src/quote.test.ts},graders/{timeout-2000,test-not-edited,test-not-written,timeout-implemented,skill-loaded}.md}`

- [x] Fixture as in criterion 5; in a temp copy `npm test` → expect the hung-provider test to FAIL (cancelled by its own 5 s limit), the fast-provider test PASS; apply the reference fix → both PASS; behavior.ts on the fixture's file → violation, on the fixed file → none
- [x] Graders: regex `2000|2_000|2 \* 1000` in `src/quote.ts` (contains), tool_used Edit/Write on `quote.test.ts` max 0, llm judge "rejects with QuoteTimeoutError when the provider takes longer than 2 s, clears the timer, no retry; FAIL on a changed test, a skipped test or a timeout other than 2 s"
- [x] `npm test`, `claude plugin validate .` PASS; EVALS.md Cases row; commit `test(evals): add the spec-timeout case`
- [x] `npm run eval -- --case spec-timeout --trust-plugin --keep-temp --json <scratch>` (3 runs per arm); `node scripts/eval-behavior.ts <json>`; record scores, behavior counts and cost in Progress

### Task 5: writing-plans trim

**Files:** Modify `{src_claude,src}/skills/writing-plans/SKILL.md`

- [x] Trim to ≤ 780 body words in both, same text; list the removed phrases in Progress
- [x] Lint both PASS; commit `docs(plans): room under the word budget`

### Task 6: docs and release

- [ ] Post-implementation list; versions 0.27.0; pins; `node .github/release.ts check` both → ok; `npm test && npm run typecheck` both PASS; commit `docs: 0.27.0`

## Progress

- Plan approved 2026-10-17, inline execution.
- Baseline: kit verify script → typecheck and test PASS in both editions (eng-kit 469 tests, pi 448). Drift: none (branches cut from Base).
- Task 1: complete (eng-kit a9bdcba..62680f9, pi c8096a5..b010ed0; lint 41/41 both). `^effort: xhigh` now in exactly 10 skills plus both agents. Ruling: pi README line 24 and the subagents line, the guides' `/implement` walkthrough ("switches to `fast`") and the ARCHITECTURE models row also said implement ran mid-tier; updated in the same commit (the `worker` in pi-subagents writes the code) — cost if wrong: none, docs only.
- Task 2: complete (62680f9..HEAD; `node --test tests/eval-behavior.test.ts` RED on the stub: 3 fail, actual [] vs expected lines; GREEN 3/3; kit verify script PASS both editions). The runner keeps the event loop alive so a never-settling check is killed by the timeout instead of exiting with code 13. Folder install copies scripts by an allowlist (lib/install.ts:45), so the new scripts stay out of projects.
- Ruling (criterion 4): the check covers the ticket's contract only — separators parse, misplaced separators and "abc" throw. "12x" and "1.2.3", which the fixture's original parseInt already accepted, were dropped: with them every arm scored about 0 and the check measured unrequested hardening, not the root cause — cost if wrong: a fix that newly accepts "12x" isn't flagged (the original accepted it too).
- Task 3: complete (`node scripts/eval-behavior.ts` on the kept 0.26.0 results): kit arm 3/3 + 6/6 before, 3/3 + 6/6 after; without the kit 2/3 + 6/6 before, 3/3 + 5/6 after (the failing runs accept "1,2,3x", "1,50", "12,34.5"). With the wider input set first tried, the kit arm was 0/9 before and 1/9 after, matching the 0.26.0 manual table. The root-cause fix held in every kit run; the 0.26.0 judge drop was noise.
- Task 4: complete (425aefa..2cd17da + eval). Fixture in a temp copy: hung-provider test cancelled at its own 5000 ms limit, the other two pass; reference fix (race with a cleared 2000 ms timer) → 3/3 pass, the hung case in 2001 ms. Behavior check: original file → "a hung provider was still pending after 3000 ms" (a 3 s guard inside the check, so it doesn't wait for the 10 s process timeout), fixed file → none. The timeout regex misses the original and matches the fix. `evals/*/behavior.ts` added to tsconfig so the checks are typechecked. Eval (claude 2.1.302, sonnet, 3 runs per arm, $0.57): with 1.00 / without 1.00, every grader 3/3 in both arms; behavior 3/3 in both. The kit does not over-apply the symptom-remedy rule to a timeout the spec requires; the case stays as that guard.
- Task 5: complete (pi 5493589; eng-kit in the next commit): writing-plans 778 (pi) / 775 (Claude) words. Removed: "The task file … the guard blocks a PR or merge while it exists" (said in executing-plans and git-workflow), "if it is still a draft" → "for a draft", the recommendation sentence's three clauses → "weighing coupling, task count and the cost of a mistake". No rule removed.
