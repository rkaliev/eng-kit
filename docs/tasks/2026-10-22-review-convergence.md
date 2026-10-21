# Fewer review rounds at the same strictness

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: d1f39ff35c259dd9ab9da0a1f3139561f47daa87 (pi: 5c57e17093fc8013e67619c62238bfe643422b50)
Links: docs/FRAMEWORK-SOURCES.ru.md §11.15 (review gate, the 0.13.0 removal of the exempt list) in the workspace; fortune-os `plugins/fos/skills/pr-review`, `pr-monitor`

<details><summary>Original request</summary>

проведи анализ чем наше ревью отличается от fortune-os именно в качестве ревью, кол-ве прогонов и тд

давай все 4 начни думать как реализовать

давай реализовывать пиши планы и выполняем

</details>

## Intent

A kit user gets a branch through review in 2–3 rounds instead of 4–12, with the gate and the fixed severities exactly as strict as today.

## Context

The gate needs a recorded `Yes` on the exact landed SHA, and repeat rounds already review only the new range (`lib/reviews.ts`, `scripts/review-log.ts`). Rounds still multiply: any docs edit after a `Yes` gets a full review, a repeat round may raise new Important findings on unchanged code it already reviewed, Minor findings after a `Yes` get fixed and so need another round, and nothing stops an author who keeps losing the same finding. fortune-os closes each of these with an explicit rule (round state machine, skip without new findings, prose-only rewrites need no round, attempt caps in `pr-monitor`).

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | Every row of the fixed-severities table and every bullet of the other checklist sections carries a stable ID (`SEV-NN`, `COR-NN`, `TST-NN`, `SEC-NN`, `ARC-NN`, `AI-NN`, `HYG-NN`), unique in the file | unit: `lint-skills.test.ts` "checklist rules carry unique stable IDs" (both editions), seen failing on the current checklist |
| 2 | `review-log.ts <BASE>` prints `Round N of this branch's review chain` and one line per earlier round (`<base7>..<sha7> <verdict>`) back to the round whose range starts on the remote base; full reports only for `<BASE>`'s round, as today | unit: `reviews.test.ts` "reviewChain lists the earlier rounds of a chain, newest first" and "reviewChain stops at a broken link" (both editions) |
| 3 | The reviewer prompt defines Full, Repeat and Prose rounds; a Prose round applies only when the previous round's verdict is `Yes` and every path in `git diff --name-only BASE..HEAD` is on the prose list, and otherwise the reviewer runs a Repeat round | probe: reviewer agent on a fixture where the delta after `Yes` is `docs/guide.md` plus `skills/x/SKILL.md` → report says Repeat; with only `docs/guide.md` → Prose, `Yes` |
| 4 | In a Repeat round, code unchanged since an earlier round gets a new finding only at Critical; anything less goes to Out of scope as `missed earlier (<severity>)`, which the author moves to Follow-ups | probe: fixture with an Important-level defect left in round-1 code and an unrelated fix in round 2: before the change the reviewer raises it as Important (RED), after it lists it as `missed earlier` and it doesn't set the verdict |
| 5 | Each finding has an ID `F<n>` kept across rounds of one chain, and the checklist rule ID in brackets where one applies; a finding open for several rounds names them (`F2 (rounds 1–3)`) | probe reports from criteria 3–4 |
| 6 | The author stops and asks the user when one finding (same ID) is still open after two fix attempts, or when Critical or Important findings are open after the third round of a chain, offering: fix again, rethink the design, the user rules on it, or move it to Follow-ups (never a Critical) | eval `review-round-cap`: with the kit the final message escalates F2 with those options and `src/` is not edited again; seen failing before the skill change |
| 7 | After a `Yes`, Minor findings are not fixed on the branch: they go to the task file's Follow-ups (the final report once it is gone) | eval `minor-after-yes`: with the kit `src/` is unchanged and both Minors are in Follow-ups; seen failing before the skill change |
| 8 | The gate is unchanged: no edit to `checkReview` or the chain rules, and the existing `reviews.test.ts` cases pass unedited | `git diff` on `lib/reviews.ts` touches only the new export; full suite green |

## Scope

**In scope:**
- both editions: `src_claude` (eng-kit) and `src` (pi), skills, `lib/reviews.ts` (byte-identical), `scripts/review-log.ts`, tests, docs, CHANGELOG;
- two eval cases (Claude edition, where evals live) and two reviewer probes recorded in `docs/EVALS.md`.

**Out of scope:**
- any change to what the gate accepts;
- rule IDs in the platform and domain skills' review points (Follow-ups);
- a hook that counts rounds (the user chose instruction + review-log).

## Decisions

1. Prose-only deltas get a light round, not a gate exemption: the 0.13.0 exempt list let commits land unreviewed. The reviewer checks the round's preconditions itself and falls back to Repeat.
2. Prose list (fixed): task files, Markdown under `docs/`, `README*`, `CHANGELOG*`. Never prose: `CLAUDE.md`, `AGENTS.md`, `SKILL.md`, anything under `.claude/`, `.pi/`, `rules/`, `skills/`, `agents/`, `prompts/`, `templates/`, decision records (`docs/decisions/`, `docs/adr/`), and code comments.
3. Round cap by instruction and review-log, no hook (user, 2026-10-21).
4. Rule IDs cover all of `checklist.md`; a removed ID is never reused; the domain skills follow later (user, 2026-10-21).
5. Branch from `main`, not stacked on `feat/docs-language` (user, 2026-10-21); CHANGELOG under `0.32.0`, **assumed** to land after 0.31.0 — renumber at merge if it lands first.
6. A new finding on unchanged reviewed code is allowed only at Critical, so a security or money defect is never hidden by the round rule.

## Design

- **Round types** live in `reviewer-prompt.md`; the author fills `{ROUND}` (Full / Repeat / Prose) in requesting-code-review step 2, the reviewer verifies it (Full: BASE = RULES_BASE; Repeat: BASE = the previous round's HEAD; Prose: also previous verdict `Yes` from review-log and the name-only check). A Prose round checks the changed text against the code at HEAD (facts, commands, paths, links) and nothing else.
- **`reviewChain(projectDir, sha, root?)`** in `lib/reviews.ts`: from the round recorded for `sha`, follow its first recorded base to the round recorded for that base, newest first, until a base has no record or 20 links; returns `Array<{ sha, base, verdict }>`. No git calls (the gate's checks stay where they are). `review-log.ts` prints the header from it.
- **Finding IDs** are kept by the reviewer from the reports review-log prints; new findings continue the numbering.
- **Author rules** in receiving-code-review (stop rule, Minors after `Yes`) and one line in requesting-code-review step 4.

## Rollout

None: skills, a script and docs. Records already in the store stay valid; a chain with records from before this release prints rounds without finding IDs.

## Risks and open questions

- The reviewer misclassifies a delta as prose → it runs `git diff --name-only` and the list is closed; probe criterion 3 covers the trap.
- The Critical-only rule hides an Important defect on unchanged code → it goes to Out of scope, which the author reports; the first full round still sees all code.
- Evals measure the author side only; the reviewer side is a probe on fixtures (subagent output isn't graded by `claude plugin eval`).

## Follow-ups

- The reviewer's shell refuses a verification command with a glob (`node --test src/*.test.ts`) and commands named only in CLAUDE.md, so it can't run such a project's tests (seen in the Task 3 probes).
- Stable IDs for the review points of web-frontend, mobile-development, desktop-development, payments-and-money, pos-systems and security-review.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** fewer review rounds through round types, finding and rule IDs, and an author stop rule, with the gate unchanged.
**Architecture:** prompt and skill rules carry the behavior; one read-only helper in the shared `lib/reviews.ts` feeds `review-log.ts`; tests guard the IDs and the helper.
**Stack / constraints:** Node ≥ 22.18, `node --test`, TypeScript 5.9.3, no new dependencies. `lib/reviews.ts` stays byte-identical to `src/extensions/lib/reviews.ts`. Files are English. Skill word budgets per `lint-skills.test.ts`.
**Verification:** `node <kit root>/scripts/verify.ts` in each repo (`npm run typecheck`, `npm test`).

### Review focus
1. A chain whose BASE record is missing (failed run) — `reviewChain` stops there, review-log still prints the reports.
2. A prose delta with a `SKILL.md` or `docs/decisions/` path — must fall back to Repeat.
3. A checklist row added with a reused or duplicate ID.
4. Parallel reviewers of one round with different bases — `reviewChain` follows the first, as the gate accepts any.
5. A Critical on unchanged code in a Repeat round is still reported.

### Post-implementation
- `CHANGELOG.md` (both): `## 0.32.0` entry.
- `docs/ARCHITECTURE.md` + `.ru.md` (Claude), pi's architecture doc: reviewer row and review gate paragraph name the round types and review-log's chain header.
- `README.md` (both): review gate bullets.
- `docs/EVALS.md`: two cases and the two probes with results.
- Workspace `docs/FRAMEWORK-SOURCES.ru.md` §11.44 (Russian, for the user): what was taken from fortune-os and why.
- `package.json`/plugin manifests version → 0.32.0 per `.github/release.ts` checks.

### Task 1: checklist rule IDs

**Files:** Modify `skills/requesting-code-review/references/checklist.md` (both) · Test `tests/lint-skills.test.ts` (both)

- [x] Write test `checklist rules carry unique stable IDs`: every table row under "Fixed severities" starts with a cell `^(SEV)-\d{2}$`, every `- ` bullet in the other sections starts with `^(COR|TST|SEC|ARC|AI|HYG)-\d{2} `, no ID repeats
- [x] Run `node --test tests/lint-skills.test.ts` → expect FAIL: first row has no ID
- [x] Add the ID column to the table (`| ID | Finding | Severity |`) and IDs to bullets, numbered in file order; one line under the heading: "IDs are stable: a removed rule's ID is not reused; a new rule takes the next number."
- [x] Run the test → PASS; full suite; repeat in `src`
- [x] Commit `feat(review): stable rule IDs in the checklist`

### Task 2: review chain in review-log

**Files:** Modify `lib/reviews.ts`, `scripts/review-log.ts` (both; pi path `extensions/lib/reviews.ts`) · Test `tests/reviews.test.ts` (both)
**Interfaces:** Produces `reviewChain(projectDir: string, sha: string, root?: string): Array<{ sha: string; base: string; verdict: Verdict }>`

- [x] Write tests with the `repo()` helper: "reviewChain lists the earlier rounds of a chain, newest first" (rounds head←base `No`, fixed←head `With fixes`, final←fixed `Yes`: `reviewChain(final)` = three entries, final first, verdicts `Yes`, `With fixes`, `No`); "reviewChain stops at a broken link" (middle round unrecorded → one entry). Stub `reviewChain` returning `[]`
- [x] Run `node --test tests/reviews.test.ts` → expect FAIL on lengths (3 vs 0)
- [x] Implement over `readReviews` (no git calls, at most 20 links); `review-log.ts` prints `Round N of this branch's review chain` (N = chain length + 1) and `Earlier rounds: <base7>..<sha7> <verdict>, …` before the reports; then copy `lib/reviews.ts` to pi and adjust the script import
- [x] Run both suites → PASS; `cmp` the two `reviews.ts` files
- [x] Commit `feat(review-log): print the round number and earlier rounds`

### Task 3: round types and finding IDs in the reviewer prompt

**Files:** Modify `skills/requesting-code-review/reviewer-prompt.md`, `skills/requesting-code-review/SKILL.md`, `agents/reviewer.md` (Claude), pi `prompts/review.md` if it fills the template · Probe fixtures in the scratchpad only

- [x] RED probe: scratch repo with a remote. Round 1 code holds two Important defects in different files, A and B; record round 1 as `With fixes` with a report that names only A (`recordVerdict` with that report). Round 2 fixes A only and leaves B's file untouched. Dispatch the installed `eng-kit:reviewer` on round 2 with the current template → expect B raised as Important (keep the report)
- [x] Edit the template: `## Round` section with `{ROUND}` and the three types and their checks (Decisions 1, 2, 6), finding format `F<n> [<rule ID>] file:line · …`, ID carry-over from review-log, `F2 (rounds 1–3)`; SKILL step 2 names `{ROUND}`; reviewer.md one line on round scope
- [x] GREEN probes: same fixture → planted defect under Out of scope, `Yes`; prose fixture (after `Yes`, delta `docs/guide.md`) → Prose, `Yes`; trap (`docs/guide.md` + `skills/x/SKILL.md`) → Repeat
- [x] Full suite (word budgets) both repos; mirror to pi
- [x] Commit `feat(review): full, repeat and prose rounds with finding IDs`

### Task 4: author stop rule and Minors after Yes

**Files:** Create `evals/review-round-cap/`, `evals/minor-after-yes/` (case.yaml, prompt.md, scaffold.sh, fixture, graders) · Modify `skills/receiving-code-review/SKILL.md`, `skills/requesting-code-review/SKILL.md` (both)

- [x] Write both cases. `review-round-cap`: fixture with `src/`, a task file and `review/round-3.md` (F2 Important open in rounds 1–3, git log shows two fix commits for it); graders: llm on the final response (escalates F2 with the four options, doesn't call it ready), regex/llm that `src/` was not edited. `minor-after-yes`: `review/round-2.md` says `Yes` with two Minors; graders: `src/` unchanged, both Minors in the task file's Follow-ups
- [x] RED: `npm run eval -- --case review-round-cap --runs 1` and the same for `minor-after-yes` → expect the kit arm to fail the escalation / unchanged-src graders
- [x] Add to receiving-code-review a "When rounds don't converge" paragraph (criteria 6–7) and to requesting-code-review step 4 "After `Yes`, Minors go to Follow-ups"
- [x] GREEN: re-run both cases, 3 runs → kit arm passes; record numbers for EVALS.md
- [x] Mirror the skill edits to pi; full suites
- [x] Commit `feat(review): stop when rounds don't converge; Minors after Yes to follow-ups`

### Task 5: docs and release

**Files:** Modify the Post-implementation docs above (both repos), version fields

- [x] Update each doc listed in Post-implementation; bump versions to 0.32.0
- [x] Run verify in both repos → PASS (release checks included)
- [x] Commit `docs: review convergence (0.32.0)`

## Progress

- Baseline 2026-10-22: verify green in both repos (typecheck, tests).
- Ruling: the cross-edition ID parity check from Task 1 is dropped — each repo's test sees only its own checklist; the IDs were compared by `diff` (only HYG-03's CLAUDE.md/AGENTS.md wording differs) — cost if wrong: an edition drifts until the next diff.
- Ruling: Task 2's tests were seen failing in the Claude edition only; pi's `reviews.ts` is the same file (`cmp`) — cost if wrong: none beyond a missed pi-only import error, which the suite would show.
- Ruling: probe fixtures have no remote (a push to a fixture remote is a landing the guard refuses); the chain anchors on the local `main`.
- Ruling: criterion 4 — a defect round 1 missed is real, so it is listed as `missed earlier (<severity>)` and goes to Follow-ups instead of being dropped; the RED probe showed the delta's own finding (fix without a regression test) is legitimate, so the verdict isn't expected to be `Yes`.
- Task 1: complete (d1f39ff..3db8c62 / pi 5c57e17..28b9ead, `node --test tests/lint-skills.test.ts` → FAIL on the missing ID column, then verify → all checks passed in both)
- Task 2: complete (3db8c62..7b3785b / pi 28b9ead..deb3e74, `node --test --test-name-pattern=reviewChain` → FAIL `[]` vs 3 and 1 entries, then PASS; review-log on a scratch chain printed `Round 3 … 84aab1f..06f537e With fixes, eca87ea..84aab1f No`; verify → all checks passed in both)
- Task 3 RED (2 runs, current template): both raised the unchanged round-1 metric label as Important, verdict With fixes.
- Task 3 GREEN probes (new template): Repeat ×2 — the missed round-1 defect listed as `missed earlier (Important)` outside the verdict, the delta's own finding kept (Important once, Minor once), F-IDs and `[SEV-…]` present; Prose → Yes; trap with `skills/quotes/SKILL.md` → refused Prose, ran Repeat, found the skill line.
- Task 3: complete (7b3785b..3629f28 / pi deb3e74..f848c41, lint-skills PASS, verify → all checks passed in both)
- Ruling: `--case '{a,b}'` isn't a glob `claude plugin eval` expands — each case ran on its own.
- Task 4: complete (3629f28..0858703 / pi f848c41..a9b4826; RED: review-round-cap with 0.50, minor-after-yes with 0.33; GREEN 3 runs: both 1.00 with the kit, 0.67 / 0.33 without; verify → all checks passed in both)
- Task 5: complete (0858703..3117fc5 / pi a9b4826..1a0d1be; `claude plugin validate .` passed; verify → all checks passed in both); workspace FRAMEWORK-SOURCES §11.44 written.
