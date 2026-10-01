# Review gate covers the whole branch, open PRs and a read-only reviewer

Status: in progress
Base: 5cc613d50b87443036b8c18fb567204f27b93c7a (pi edition: 5294f9a92ba1250d8345b2ef97da7064119c89fc)
Links: comparison with fortune-os (private FRAMEWORK-SOURCES §11.15, to be extended as §11.17)

<details><summary>Original request</summary>

"проведи анализ где код ревью получится качетсвенне и где тесты более качественные, какие основные подходы и паттерны у нас используются для написания кода и где они качественнее?" → "ну я не про йоду, а про kit и fortune os" → chosen: "Закрыть дыры review gate", "я бы взял только лучшеи чтоб не было дыр, логично и связанно было". CI AI review: "Отдельной задачей".

</details>

## Intent

No commit leaves the agent's session toward the base branch unless a read-only reviewer passed the whole path from the remote base to that commit, having read the previous round's findings itself.

## Context

The gate (0.13.0, `lib/reviews.ts`) checks only that the landed SHA has a `Yes`. Which range the reviewer saw is up to the author's prompt. Pushing new commits to an open PR is not gated. The previous findings reach a repeat round through the author. The reviewer's read-only rule is an instruction. A crashing hook lets the command through (`hooks/hook.ts:7`).

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | A `Yes` on HEAD whose `Reviewed BASE` is not reachable from `refs/remotes/<remote>/<base>` and has no covered record of its own does not cover HEAD: PR create, merge into the base and push to the base are refused | unit, `tests/reviews.test.ts` (narrow BASE) |
| 2 | A repeat round `P..H` covers H when P has a record that is itself covered, at any verdict, up to 20 links; a chain whose P is not an ancestor of H (a rebase) does not | unit, `tests/reviews.test.ts` (chain, rebase, depth) |
| 3 | A report without one `Reviewed BASE:` line is sent back once; a second miss records Inconclusive. Records written before this change (no `base`) cover nothing | unit, `tests/hooks.test.ts`, `tests/reviews.test.ts` |
| 4 | The hook stores the report with its record (size-capped); `scripts/review-log.ts <sha>` prints the latest round's reports for that commit, and prints nothing and exits 1 when none exist | unit + process test of the script |
| 5 | After a successful `gh pr create` / `glab mr create` the branch is remembered; a later push to that branch needs coverage like a push to the base. The entry goes when the branch is merged into `origin/<base>` or after 30 days. Writes to the PR list from the shell are blocked like the verdict records | unit, `tests/hooks.test.ts`, `tests/reviews.test.ts` |
| 6 | Inside the reviewer subagent, Bash runs only an allowlist (read-only git, `git worktree add/remove` under the temp folder, read commands, the project's verify commands, `review-log.ts`); anything else is denied | unit, `tests/hooks.test.ts`; live probe that PreToolUse carries `agent_type` in a subagent |
| 7 | A crash while handling PreToolUse answers `ask` with the error, never exit 1; pi's guard answers `confirm` | process test, `tests/hooks.test.ts`; pi `tests/extensions.test.ts` |
| 8 | The reviewer prompt reads the manifest, path rules and decision records at `{BASE}`; the skill requires a parallel security-focused reviewer for the risk-floor categories (money, auth, permissions, secrets, schema, CI) | review of the skill text (checklist) |
| 9 | Both editions behave the same: `reviews.ts` byte-identical, pi records from `tool_result` with the same rules (pi asks where Claude denies) | `tools/compare-editions.mts`, pi `tests/extensions.test.ts` |

## Scope

**In scope:**
- `src_claude/`: `lib/reviews.ts`, `lib/hooks.ts`, `hooks/hook.ts`, `agents/reviewer.md`, new `scripts/review-log.ts`, `skills/requesting-code-review/*`, tests, `docs/ARCHITECTURE*.md`, `CHANGELOG.md`, version 0.14.0.
- `src/` (pi): the same `reviews.ts`, `scripts/review-log.ts`, `extensions/guard.ts`, the skill, tests, docs, CHANGELOG.
- Private workspace: `docs/FRAMEWORK-SOURCES.ru.md` §11.15 updated to 0.13.0 and a new §11.17.

**Out of scope:**
- An AI review check in CI (Follow-ups).
- The kit's own `reviewer` definition for pi-subagents (Follow-ups).
- Detecting PRs the agent did not open.
- Mechanically requiring the security reviewer.

## Decisions

1. Repeat rounds stay incremental, anchored by a chain of records (like fortune-os's `commit_id` anchor), rather than forcing a full review each round: cheaper, and the chain keeps the whole-branch guarantee.
2. The previous findings come from the store, not from the author, because a chain round would otherwise let the author drop an open Critical.
3. An open PR is known only from the agent's own successful `pr create` (no network call in the guard). PRs opened elsewhere are a documented limit.
4. The security reviewer is required in text only: path heuristics never converged in 0.13.0's review rounds.
5. On a crash PreToolUse asks rather than denies, so a guard bug stops the agent without locking the user out.
6. CI AI review is a separate task (user, 2026-10-01): it needs a secret, costs per push and needs its own injection defence.
7. PreToolUse inside a subagent carries `agent_type` and `agent_id` (verified live on claude 2.1.286: `"agent_type":"reviewer"` in the subagent, `null` in the main agent).

## Design

- **Record:** `{ base, sha, verdict, promptId, at, report }`. `report` is capped at 200 KB. `parseReview` returns `{ base, sha, verdict }` and needs exactly one value for each line.
- **Coverage** `covered(sha)`: the latest round for `sha` combines to `Yes`, and `chainOk(record.base, sha, depth)` holds:
  - `base` is an ancestor of `sha`;
  - and either `base` is an ancestor of `refs/remotes/<remote>/<base>`, or some record for `base` exists and `chainOk(that.base, base, depth+1)` holds;
  - the depth is at most 20.
  - `uncovered()` names which link failed.
- **Open PRs:** `<reviewsDir>/prs.json` = `{ branch: at }`.
  - It is written by a new `postToolUse` handler. On pi the write happens on the `tool_result` of a successful `bash` call.
  - `targets()` treats a push whose destination branch is listed like a push to the base.
  - The file is pruned on read: an entry goes once the branch tip is an ancestor of `origin/<base>`, or after 30 days.
- **Reviewer allowlist:** in `preToolUse`, when `agent_type` matches `^(eng-kit:)?reviewer$`, `checkReviewerCommand(command, verify)` allows only the listed segments. It reuses `splitSegments`/`tokenize` and the read-only sets in `reviews.ts`.
- **Fail closed:** `hook.ts` catches the error. If the event was PreToolUse, it prints `permissionDecision: "ask"` with the error; other events keep exit 1.
- **Prompt and skill:** the verdict block gains `Reviewed BASE: {BASE}`. A repeat round runs `node {KIT_ROOT}/scripts/review-log.ts {PREVIOUS_REVIEW_HEAD}`. The rules are read at `{BASE}`. The security reviewer is required for the risk floor.

## Rollout

After the update, old records lack `base`, so the first landing on each branch needs one new review. CHANGELOG says so. There is nothing to migrate.

## Risks and open questions

- `gh pr create` succeeding is read from PostToolUse (success only, failures go to PostToolUseFailure, verified in 0.2.x) → covered by a hooks test.
- A longer prompt for the reviewer → the Bounded path still uses the same template; the size is checked in review.

## Follow-ups

- Optional AI review check in CI (`ci-quality-gates` template, head-SHA check, same reviewer prompt, user's consent).
- The kit's own `reviewer` agent for pi-subagents (read-only tools, model), if pi-subagents lets a project override the built-in one.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** the review gate admits a landing (PR create, push to an open PR's branch, merge into or push to the base) only when a chain of reviewer rounds covers everything from the remote base to the landed commit, and the reviewer can only read.
**Architecture:** `lib/reviews.ts` (byte-identical in both editions) gains a `base` and a `report` per record, the chain check, the open-PR list and the reviewer's command allowlist. The Claude hooks (`lib/hooks.ts`, `hooks/hook.ts`) and pi's `extensions/guard.ts` only wire them. A small `scripts/review-log.ts` prints a commit's stored reports.
**Stack / constraints:** Node ≥22.18 running `.ts` directly, no new dependencies, `node:test`. `reviews.ts` and `workdocs.ts` stay byte-identical between `src_claude/lib/` and `src/extensions/lib/`. Version 0.14.0 in `package.json`, `.claude-plugin/plugin.json` and `CHANGELOG.md` (pi: `package.json`, `CHANGELOG.md`). Limits: report 200 000 chars, chain depth 20, PR entries 30 days.
**Verification:** `npm test && npm run typecheck && node .github/release.ts check` in `src_claude/`; `npm test && npm run typecheck` in `src/`; `node tools/compare-editions.mts` in the workspace.

### Review focus
1. A reviewer passing its own range `BASE=HEAD` (empty range) must not cover anything.
2. A repo with no remote, or a remote without a tracking ref for the base: the chain falls back to the local base branch. This must not admit local unreviewed commits when a tracking ref exists.
3. A `gh pr create` that fails (PostToolUseFailure) must not register the branch.
4. A reviewer chaining shell tricks (`git diff; rm -rf x`, `$(…)`, a redirect `> file`) must not pass the allowlist.
5. A hook crash in an event other than PreToolUse keeps exit 1 and does not print an `ask`.

### Post-implementation
- `docs/ARCHITECTURE.md` and `.ru.md` (both editions), review gate section: the chain rule, the open-PR rule, the reviewer allowlist (Claude only), fail-closed PreToolUse, the limit that PRs opened outside the agent are not seen.
- `skills/requesting-code-review/references/review-gate.md` (both editions): the same rules for the agent.
- `CHANGELOG.md` 0.14.0 (both): the behavior changes, and the note that old records need one new review.
- Private workspace `docs/FRAMEWORK-SOURCES.ru.md`: §11.15 drops the 0.12.0 exempt-list wording; new §11.17 explains what was taken from fortune-os (commit anchor, rules on base, findings from the store) and why.
- No decision record: the kit keeps its decisions in the FRAMEWORK-SOURCES document.

### Files
- `lib/reviews.ts`: records with `base`/`report`; `parseReview`, `readReviews` (rounds with `bases`), `readReports`, the chain check in `uncovered`, `rememberPr`/`openPrBranches`, `checkReviewerCommand`.
- `lib/workdocs.ts`: unchanged unless `pushedToBase` needs a rename (it is reused for PR branches as is).
- `lib/hooks.ts`: subagentStop (BASE send-back, report stored), postToolUse (`rememberPr` on success), preToolUse (reviewer allowlist), new `respond()` wrapper used by `hooks/hook.ts`.
- `hooks/hook.ts`: calls `respond()`.
- `scripts/review-log.ts` (new); `lib/install.ts` copies it.
- `agents/reviewer.md`, `skills/requesting-code-review/{SKILL.md,reviewer-prompt.md,references/review-gate.md}`.
- Tests: `tests/reviews.test.ts`, `tests/hooks.test.ts`, `tests/install.test.ts`.
- pi `src/`: `extensions/lib/reviews.ts` (copy), `scripts/review-log.ts`, `extensions/guard.ts`, the same skill files, `tests/extensions.test.ts`.

### Task 1: the chain covers the branch

**Files:** Modify `lib/reviews.ts` · Test `tests/reviews.test.ts`
**Interfaces:** Produces `parseReview(text): { base, sha, verdict } | undefined`, `ReviewRecord { sha; base?: string; verdict; promptId; at; report?: string }`, `readReviews(projectDir, root?): ReviewRound[]` where `ReviewRound { sha; verdict; promptId; at; bases: string[] }`, and `recordVerdict(projectDir, rev, verdict, ids, root?, extra?: { base?: string; report?: string })`.

- [x] Change the test helper `report(sha, verdict, base = mergeBase)` to also write `Reviewed BASE:`. Write failing tests:
  - `a Yes whose BASE is not on the remote base and has no covered record does not cover HEAD`: a review of `head~1..head` on a branch of 2 commits gives `check("gh pr create")` → `block` with `/does not cover/`;
  - `a repeat round chains to a covered earlier round at any verdict`: a full round `No` on c1, then a round `c1..c2` `Yes` → c2 allowed;
  - `a rebase breaks the chain`: c1 reviewed, branch rebased, the c1-based round on the new head → blocked;
  - `an empty range covers nothing`: `BASE = HEAD` → blocked;
  - `records without base cover nothing`: write a 0.13.0-style JSON record directly → blocked;
  - `a chain longer than 20 links is refused`;
  - `without a tracking ref the local base anchors the chain; with one, the local base does not`.
- [x] Run `node --test tests/reviews.test.ts` → expect FAIL: the narrow-BASE test returns `undefined` (allowed) instead of a block.
- [x] Implement:
  - `parseReview` requires exactly one `Reviewed BASE:` line: `/Reviewed BASE[*_]*:[*_\s`]*([0-9a-f]{7,40})\b/gi`;
  - `recordReview` resolves `base` with `rev-parse` (an unknown base returns an error string) and stores `report` cut to 200 000 chars;
  - `readReviews` returns rounds with the `bases` of the latest prompt's records;
  - in `uncovered`, after the `landed` check: the round for `sha` is `Yes`, and some `b` in `round.bases` passes `chainOk(where, b, sha, rounds, anchor, 0)`;
  - `chainOk(where, base, sha, rounds, anchor, depth)`: false if `base === sha` or `base` is not an ancestor of `sha`; true if `anchor` exists and `base` is an ancestor of it; otherwise recurse through the round for `base` (`depth + 1`, at most 20);
  - `anchor` is `refs/remotes/<remote>/<base>` if it resolves, else `refs/heads/<base>`;
  - the reason names the first link that fails: `the review of <sha> covers <base>..<sha>, and <base> has no covered review`.
- [x] Run `node --test tests/reviews.test.ts` → expect PASS, then `npm test`.
- [x] Commit `feat(review-gate): a verdict covers its whole range back to the remote base`.

### Task 2: the reviewer reports BASE, and its findings are kept

**Files:** Modify `lib/hooks.ts`, `lib/reviews.ts`, `lib/install.ts` · Create `scripts/review-log.ts` · Test `tests/hooks.test.ts`, `tests/install.test.ts`
**Interfaces:** Consumes Task 1's `parseReview`/`recordReview` · Produces `readReports(projectDir, sha, root?): Array<{ run: string; verdict: Verdict; report: string }>` (the latest round only), and the CLI `node scripts/review-log.ts <rev>`.

- [x] Write failing tests:
  - `SubagentStop: a report without Reviewed BASE is sent back once, then counts as Inconclusive` — `decision: "block"` with reason `/Reviewed BASE/`, then an Inconclusive record;
  - `the stored report is printed by review-log for that commit` — spawn the script with `CLAUDE_PROJECT_DIR` and a test records root (env `ENG_KIT_REVIEWS_ROOT`), expect exit 0 and stdout containing the report's first finding line;
  - `review-log with no record exits 1` — stderr `no recorded review for <short sha>`;
  - in `install.test.ts`: `.claude/eng-kit/scripts/review-log.ts` is installed.
- [x] Run `node --test tests/hooks.test.ts tests/install.test.ts` → expect FAIL: the send-back reason lacks `Reviewed BASE`, and the script file doesn't exist.

  Add an empty `scripts/review-log.ts` stub first, so the failure is an assertion.
- [x] Implement:
  - the send-back reason in `subagentStop` names all three lines;
  - `review-log.ts` resolves `<rev>` in its cwd and reads `readReports(process.env.CLAUDE_PROJECT_DIR || cwd, sha, process.env.ENG_KIT_REVIEWS_ROOT)`;
  - it prints `## Reviewer run <run> — <verdict>` and then the report;
  - `install.ts` adds `review-log` to the scripts filter.
- [x] Run → expect PASS, then `npm test`.
- [x] Commit `feat(review-gate): reviewers report BASE; review-log prints a commit's stored findings`.

### Task 3: pushing to an open PR's branch is a landing

**Files:** Modify `lib/reviews.ts`, `lib/hooks.ts` · Test `tests/reviews.test.ts`, `tests/hooks.test.ts`
**Interfaces:** Produces:
- `rememberPr(projectDir, command, cwd, root?): void` — records the branch of a successful `gh pr create`/`glab mr create`: the `--head`/`-s` value or the current branch where the command ran, following `cd` the way `checkReview` does;
- `openPrBranches(projectDir, where, base, remote, root?): string[]` — drops entries older than 30 days or whose branch tip is an ancestor of the anchor, and writes back.

- [x] Write failing tests:
  - `after a PR is opened, pushing a new unreviewed commit to its branch is refused`: `rememberPr(… "gh pr create" …)`, commit, `check("git push")` → block;
  - `once the new commit is reviewed, the push passes`;
  - `a merged PR branch is forgotten`;
  - `PostToolUseFailure of gh pr create registers nothing` (hooks);
  - `shell writes to prs.json are blocked` (`checkGateFiles`, same folder as the records).
- [x] Run `node --test tests/reviews.test.ts tests/hooks.test.ts` → expect FAIL: `git push` on the feature branch returns `undefined` instead of a block.
- [x] Implement:
  - `<reviewsDir>/prs.json` = `{ "<branch>": <ms> }`, written atomically with the existing `writeAtomic`;
  - in `targets()`, for a push, add `pushedToBase(l, branch, currentBranch(where) === branch)` for each open PR branch;
  - `postToolUse` calls `rememberPr` for a successful shell call before its verify bookkeeping.
- [x] Run → expect PASS, then `npm test`.
- [x] Commit `feat(review-gate): a push to the branch of a PR the agent opened needs a review`.

### Task 4: the reviewer can only read

**Files:** Modify `lib/reviews.ts`, `lib/hooks.ts` · Test `tests/reviews.test.ts`, `tests/hooks.test.ts`
**Interfaces:** Produces `checkReviewerCommand(command, cwd, verify: string[]): GuardDecision | undefined` (`undefined` = allowed).

- [x] Write failing table test `the reviewer's shell runs only inspection, temp worktrees, the verify commands and review-log`:
  - allowed: `git diff a..b`, `git -C /x log`, `git show a:CLAUDE.md`, `git worktree add $TMPDIR/r abc`, `git worktree remove <tmp>/r`, `cat f | grep x`, `npm test`, `node /kit/scripts/review-log.ts abc`;
  - blocked with `/reviewer is read-only/`: `git commit -m x`, `git checkout main`, `git worktree add ../w abc`, `rm f`, `echo x > f`, `git diff; rm f`, `cat $(echo f)`, `sed -i s/a/b/ f`;
  - hooks: a PreToolUse with `agent_type: "eng-kit:reviewer"` and `git commit` → `permissionDecision: "deny"`; the same command from the main agent → no reviewer denial.
- [x] Run → expect FAIL: `git commit` from the reviewer gets no deny.
- [x] Implement:
  - per segment: the read-only commands; git subcommands `diff show log status blame rev-parse merge-base ls-files ls-tree cat-file grep`, and `worktree list|add|remove` with a path under `tmpdir()` or its realpath;
  - `cd/pushd/popd/pwd/echo/printf/true`, the verify commands (the matching in `isSafe`), and `node …/scripts/review-log.ts`;
  - no writing redirection or `tee`: extract the test already in `checkGateFiles` into `writes(command): boolean`;
  - no `$(`, backtick or `<(`;
  - `preToolUse` runs it first for shell tools when `agent_type` matches `^(eng-kit:)?reviewer$`.
- [x] Run → expect PASS, then `npm test`.
- [x] Commit `feat(review-gate): the reviewer's shell is limited to inspection`.

### Task 5: a crashing guard asks instead of letting the call through

**Files:** Modify `lib/hooks.ts`, `hooks/hook.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Produces `respond(raw: string, env: HookEnv, handler = handle): { stdout: string; stderr: string; code: 0 | 1 }`.

- [x] Write failing tests with a throwing `handler`:
  - for `{"hook_event_name":"PreToolUse"}` → code 0, stdout `permissionDecision: "ask"`, reason `/eng-kit guard failed: boom/`;
  - for `Stop` → code 1 and empty stdout;
  - for unparsable input → code 1.

  Add a `respond` stub that returns `{ stdout: "", stderr: "", code: 1 }`.
- [x] Run → expect FAIL: the PreToolUse case gets code 1.
- [x] Implement `respond` and make `hooks/hook.ts` print its stdout/stderr and exit with its code. Update the file header comment.
- [x] Run → expect PASS, then `npm test` and a process test through `hooks/hook.ts` with valid input (existing).
- [x] Commit `fix(guard): a crash in PreToolUse asks instead of failing open`.

### Task 6: the reviewer's instructions match the gate

**Files:** Modify `agents/reviewer.md`, `skills/requesting-code-review/SKILL.md`, `reviewer-prompt.md`, `references/review-gate.md` · Test `tests/lint-skills.test.ts` (existing, must stay green)

- [ ] `reviewer-prompt.md`:
  - the Verdict block becomes `Reviewed BASE: {BASE}` / `Reviewed HEAD: {HEAD}` / `Ready to merge: …`;
  - Rules: the manifest, path rules and decision records are read at `{BASE}` (`git show {BASE}:<path>`); the branch's own rule edits are judged against them;
  - the repeat round reviews `{PREVIOUS_REVIEW_HEAD}..{HEAD}` with `BASE = {PREVIOUS_REVIEW_HEAD}`, and first runs `node {KIT_ROOT}/scripts/review-log.ts {PREVIOUS_REVIEW_HEAD}` and re-checks every finding it prints. The author no longer pastes findings.
- [ ] `SKILL.md`:
  - step 1 says the range starts at the merge-base with the remote base, or at the previous round's HEAD;
  - `{KIT_ROOT}` is the "Kit root" from the session context (project install: `.claude/eng-kit`);
  - step 3 makes a parallel security-focused reviewer **required** for the risk-floor categories (money, auth, permissions, secrets, schema, CI and release config) and keeps it optional elsewhere;
  - the gate paragraph adds the open-PR rule and the read-only shell.
- [ ] `agents/reviewer.md`: the three lines, rules at BASE, the allowlist named as enforced.
- [ ] `review-gate.md`: the chain rule, the open-PR rule and its limit, the allowlist, fail-closed PreToolUse, and old records needing one new review.
- [ ] Run `npm test` → expect PASS (lint-skills).
- [ ] Commit `docs(review): the reviewer reports BASE, reads rules at BASE and its findings from the store`.

### Task 7: pi edition parity

**Files:** Modify `src/extensions/lib/reviews.ts` (copy), `src/extensions/guard.ts`, `src/skills/requesting-code-review/*` · Create `src/scripts/review-log.ts` · Test `src/tests/extensions.test.ts`

- [ ] Copy `lib/reviews.ts` byte for byte. Write failing tests in `extensions.test.ts`:
  - `a reviewer's report without Reviewed BASE records Inconclusive`;
  - `after a successful gh pr create bash call, a push of a new commit to that branch asks`;
  - `a throwing check asks instead of passing` (fake `ctx.isProjectTrusted` throws) → `ui.confirm` called with `/guard failed/`.
- [ ] Run `npm test` in `src/` → expect FAIL: the push isn't asked about, and the throw rejects the handler.
- [ ] Implement:
  - in `guard.ts`, `tool_result` for `bash`/`powershell` with `!event.isError` calls `rememberPr(ctx.cwd, command, ctx.cwd, options.reviewsRoot)`;
  - the `tool_call` body is wrapped in try/catch, which gives `{ action: "confirm", reason: "eng-kit guard failed: <message>" }` and then the existing confirm path;
  - `scripts/review-log.ts` is the same script reading `ctx`-free: cwd, `ENG_KIT_REVIEWS_ROOT`;
  - port Task 6's skill text with pi wording: `{SKILL_DIR}/../../scripts/review-log.ts`, no reviewer allowlist (not enforced in pi, said so in review-gate.md).
- [ ] Run `npm test && npm run typecheck` in `src/` → expect PASS. Run `node tools/compare-editions.mts` → no new drift outside the adapted list. Run `cmp src_claude/lib/reviews.ts src/extensions/lib/reviews.ts` → identical.
- [ ] Commit in `src/`: `feat(review-gate): whole-branch coverage, open-PR pushes and a fail-closed guard`.

### Task 8: docs, changelog, version

**Files:** Modify both editions' `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `CHANGELOG.md`, `package.json`, `src_claude/.claude-plugin/plugin.json` · Workspace `docs/FRAMEWORK-SOURCES.ru.md`

- [ ] Write the Post-implementation items above. Set the version to 0.14.0.
- [ ] Run `node .github/release.ts check` in `src_claude/` → prints `0.14.0`. Run the full Verification in both editions → PASS.
- [ ] Commit in each repo `docs: review gate 0.14.0`.
- [ ] Finish order (git-workflow): delete this task file in its own commit, rebase if needed, run Verification, then the final review of each branch last. The PR goes only on the user's say.

## Progress

- Baseline (2026-10-01): src_claude `npm test` 281/281 pass, typecheck clean; src (pi) `npm test` 283/283 pass, typecheck clean. Drift since Base: none.
- Pre-flight: Interfaces consistent (Task 1 produces the record shape that Tasks 2–4 and 7 consume).
- Ruling: the test helper `report()` and three hooks-test verdict strings gained a `Reviewed BASE:` line; no assertion changed — the report format is the contract this task changes — cost if wrong: none, the assertions are untouched.
- Ruling: `a repeat round chains to a covered earlier round at any verdict` passed before the change, because the 0.13.0 gate let every Yes through; it guards against the chain over-blocking and was checked against the implementation — cost if wrong: a positive-path regression would be caught only by the other chain tests.
- Task 1: complete (090eaac..21f1a6c, `npm test` → 288 pass, `npm run typecheck` → clean)
- Ruling: `review-log.ts` reads the records root from `ENG_KIT_REVIEWS_ROOT` when set (tests only; the hooks never read it) — the script only reads, so the variable can't loosen the gate — cost if wrong: none for the gate.
- Task 2: complete (21f1a6c..a636165, `npm test` → 290 pass, `npm run typecheck` → clean)
- Ruling: `openPrBranches` also takes the push remote. A PR counts as merged when its head as the remote last showed it (`<remote>/<branch>`, else the local branch) is on the anchor: the local tip moves on after a merge, so the plan's local-tip check would never forget a merged PR — cost if wrong: a branch whose remote ref was deleted and pruned stays gated (over-blocking, the safe side).
- Ruling: in the hooks test, a push without a PR expects the guard's usual `ask`; the test checks that the PR turns it into `deny` — cost if wrong: none.
- Ruling: `shell writes to the open-PR list are blocked` passed before the change, because prs.json sits in the records folder the guard already protects; it pins that placement — cost if wrong: none.
- Task 3: complete (a636165..ce6d1d8, `npm test` → 294 pass, `npm run typecheck` → clean)
- Ruling: the reviewer allowlist also denies git's `-c`, `--output`, `--ext-diff` and pager options, and `worktree add -b`; it adds the pure filters `sort uniq cut tr`. The plan's list would have let `git diff --output=f` write and `git -c core.pager=…` run a command — cost if wrong: a reviewer asks for a command it needs, which the deny reason makes visible.
- Ruling: the allowlist test runs from the kit checkout, not a temp folder, because `../w` from a temp folder really is in the temp folder — cost if wrong: none.
- Task 4: complete (ce6d1d8..af44882, `npm test` → 296 pass, `npm run typecheck` → clean)
- Ruling: `respond` takes `makeEnv(input)` instead of a ready `env`, because the project dir falls back to the input's cwd — cost if wrong: none.
- Task 5: complete (af44882..HEAD, `npm test` → 297 pass, `npm run typecheck` → clean, `hooks/hook.ts` with a PreToolUse input → exit 0)
