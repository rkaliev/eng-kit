# Workspace gates: close the open review findings of 0.34.0

Status: in progress (plan approved 2026-11-03, inline)
Base: d34ccdb0d59079e602ea34a9761f615820605b61
Links: review findings after round 6 (kept outside the repo); PR #36

<details><summary>Original request</summary>

давай начнем по приоритеты

давай делать

</details>

## Intent

Teams using the kit in a single repository or a workspace get verify and review gates that don't miss a sourced file after a function header or `command -p`, that always hold a reviewed commit back when a verdict can't reach every repository, that stay within the hook's time limit, and whose docs describe what the code does.

## Context

0.34.0 (PR #36) passed six review rounds. The user ruled the sixth the last one and moved every non-Critical finding to follow-ups; this task closes them. The findings, with the code they point to:
- `bindsAsCommand` (lib/worktree.ts) starts a command position only after a STARTERS word, an opening `(`/`{` or a `)`-ending word. It misses `source`/`.` after a glued header (`f(){ . ./env; }`) and after `command -p`/`time -p`/`command --`. And it restarts the command position on a STARTERS word or a `)`-ending word that is an argument (`grep -rn "time" . > $S/x`, `rg "(A|B)" . > $S/x`), so `.` counts and the gate re-fires.
- `holdBack` (lib/reviews.ts): a lookup that found nothing because a repository hung returns "is not a commit". `holdBack` then repeats it, and the shared deadline runs out before the HEAD fallback. `reviewsDir`'s `git rev-parse --git-common-dir` (5 s) runs outside the deadline, and when it fails the record is written to a folder-keyed store nobody reads. SubagentStop's `recordUsage` (`currentBranch`, up to 5 s) runs before the 7 s deadline starts.
- The docs are stale:
  - the `callChanges` JSDoc still describes the removed any-position rule;
  - ARCHITECTURE(.ru) says a missed verdict's Inconclusive goes "else for each HEAD";
  - README and CHANGELOG don't name the `..` symlink rule.
- The other edition only: its verify tool's label for an output-limit stop, and a test of its guard's deadline wiring.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | With a blind part, `f(){ . ./env; }; echo > $S/x`, `f()(source ./env); echo > $S/x`, `command -p source ./env; echo > $S/x`, `time -p . ./env; echo > $S/x` and `command -- eval x; echo > $S/x` count every text target as when `.` is a plain command word | unit tests in tests/worktree.test.ts, each seen failing on the old code |
| 2 | `command -v source; echo > $S/x` and `command -V .` don't count as binding: they only look the name up | unit test |
| 3 | A STARTERS word or a `(`/`)` word in an argument position doesn't start a command position: `grep -rn "time" . > $S/x` and `rg "(A|B)" . > $S/x` with only a non-symlink blind part place their targets from the cwd. `case x in a) . ./env;; esac` and `if true; then . ./env; fi` still count as binding | unit tests; the binding cases pass before and after |
| 4 | A lookup that found nothing because a repository didn't answer in time says so ("could not be searched in time"), distinct from "is not a commit". `holdBack` then goes straight to each repository's HEAD without repeating the lookup, and reports the miss | unit tests in tests/reviews.test.ts with `slowGit` hanging only the SHA lookup, seen failing on the old code |
| 5 | When resolving a repository's store (`git rev-parse --git-common-dir`) times out or runs past the deadline, nothing is written to a folder-keyed store, and the result is a miss that the caller holds back and warns about | unit test with `slowGit` on `rev-parse --git-common-dir` |
| 6 | SubagentStop's lookups and store writes finish inside the 7 s deadline even when `currentBranch` hangs: the token ledger is updated after the gate work, as Stop does | hooks test that hangs the branch lookup and asserts the warning is returned within the hook timeout, seen failing on the old code |
| 7 | The two tests named weak in round 6 ("…times out again is named" in reviews, the hooks deadline test) fail on the code before their fix | each mutated or run on the parent commit; result recorded in Progress |
| 8 | (the other edition's verify tool) | — |
| 9 | (the other edition's guard) | — |
| 10 | The `callChanges` JSDoc, ARCHITECTURE and ARCHITECTURE.ru (SubagentStop and guard rows), README and CHANGELOG describe the code at HEAD: command-position rule, hold-back order (the named commit; each HEAD only when it names no commit or couldn't be searched), the `..` symlink rule | reviewer checks text against code; `node .github/release.ts check` |
| 11 | Both editions carry the same shared files byte-identical (lib/repos.ts, worktree.ts, reviews.ts, shell.ts) and release as 0.34.1 | `cmp` of the shared files; typecheck and the full test suite in both; release check |

## Scope

**In scope:**
- items 1–7, 10 and 11 above; the other edition takes the same shared files and its own items in its own PR;
- F39: STARTERS entries that can never match are removed, or kept with a comment saying why, whichever the item 1/3 fix needs.

**Out of scope:**
- the guard in a workspace (CI and protected paths in child repositories, own-branch push, task-file leak guard, approval gate, `core.fsmonitor`, `--git-dir`/`--work-tree` landings): the next task;
- mirroring non-Yes verdicts into the workspace folder's store (S18): goes with the guard task;
- the token ledger and kit-init command detection in a workspace: a later task;
- the round-5 carried items not named above: `~`/`$HOME` after a move, CDPATH from startup files, zsh `noglob`/aliases, a minimum lookup share with 32 repositories, With fixes turned Inconclusive by a hold-back, guard protection of child repositories' verify.json.

## Decisions

1. One task for the follow-ups of 0.34.0, before the guard-in-workspace task: they are defects in released code with known fixes. User's choice (2026-11-03, "давай делать" on that order).
2. Narrowing the command-position rule (item 3) reduces false re-fires only. Every case that binds as a command still counts (item 3's second half), and anything the parser can't read still fails closed.
3. **Assumed:** release as 0.34.1 in both editions (fixes only, no new behaviour beyond the output-limit label).
4. Shared files stay byte-identical across editions; they are written test-first here and copied to the other edition.

## Design

- `bindsAsCommand`:
  - a command position starts after a token ending in `(`, `{` or `)` only where that token is itself in a command position or a `case` pattern;
  - the text after the last `(`/`{` inside a token is judged as a command word;
  - `command`, `time` and `exec` keep the position across their dash options, but `command -v`/`-V` ends it;
  - STARTERS count only in a command position.
- `lookup` returns `complete`; `recordVerdict` returns a distinct "could not be searched in time" when nothing was found and the search was incomplete. `holdBack` treats that like a missing `rev`: each HEAD, then the miss.
- `reviewsDir` gets an optional deadline. In `recordVerdict` a failed or late common-dir lookup is a `failure` (a miss), never a fallback to the folder key.
- SubagentStop: the deadline starts at entry, and `recordUsage` runs after the gate's work, on every return path.

## Rollout

Patch release 0.34.1 in both editions. Rollback: install 0.34.0.

## Risks and open questions

- The tokenizer may strip quotes, so `"time"` and `time` look alike → item 3 relies on position, not on quoting. A quoted command word in a command position (`"source" ./env`) still counts.
- Hanging one git subcommand only (`rev-parse --git-common-dir`) needs `slowGit` to match on arguments → extend tests/slow-git.ts if its `only` filter can't.

## Follow-ups

- Review gate: a parsed report whose commit couldn't be searched in time, or whose store couldn't be resolved or written for a commit only one repository has, comes back as a string, so a foreground reviewer is sent back for its lines and the hold-back waits for its second stop (the write-failure case is as on 0.34.0).
- Token ledger: SubagentStop's ledger store path (`appendUsage` → `reviewsDir`, `git rev-parse --git-common-dir`, 5 s) isn't bound by the hook's remaining time.
- Guard in a workspace, with S18 (non-Yes verdicts mirrored into the folder store).
- Token ledger and kit-init command detection in a workspace.
- Round-5 carried items listed under Out of scope.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [x]` checkboxes.

**Goal:** close the 0.34.0 follow-ups (criteria 1–7, 10, 11) here; the other edition takes the shared files.
**Architecture:**
- `bindsAsCommand` in lib/worktree.ts gets an explicit command-position state.
- The review gate's lookups report "not searched in time" separately, and `holdBack` reuses a failed lookup instead of repeating it.
- The store path and the ledger are bounded by time.
**Stack / constraints:**
- Node ≥ 22.18, TypeScript run directly by Node, no new dependencies.
- The shared files (lib/repos.ts, worktree.ts, reviews.ts, shell.ts) must stay byte-identical in both editions.
- Tests use `node:test`, and hangs use `tests/slow-git.ts`; its `only` matches a substring of git's arguments, so `"--git-common-dir"` hangs only that call.
**Verification:** `node "<kit root>/scripts/verify.ts"`, run bare from the workspace root (typecheck and tests of both editions), plus `node .github/release.ts check` and, in eng-kit, `claude plugin validate .`.

### Review focus
- A word that binds and stands in a command position must still count after the narrowing: `if`/`then`/`do`/`else`, `!`, `{`, `(`, a `case` arm on its first and later lines, `builtin`, `exec`, assignments before it.
- A quoted command word (`"source" ./env`): the tokenizer strips the quotes, so it still counts.
- `holdBack` with no time left after a lookup that couldn't search: it must say so, never return `undefined`.
- `reviewsDir` callers outside `recordVerdict` (`readReviews`, review-log) keep their current fallback.
- SubagentStop's return paths: each one still updates the ledger.

### Post-implementation
- **lib/worktree.ts:** rewrite the `callChanges` JSDoc to state the command-position rule.
- **docs/ARCHITECTURE.md and docs/ARCHITECTURE.ru.md:** fix the SubagentStop and guard rows. Hold-back order: the named commit first; each HEAD only when the report names no commit or the commit couldn't be searched. A malformed report holds back the commit it names first.
- **README:** name the `..` symlink rule next to the symlink paragraph.
- **CHANGELOG:** a `## 0.34.1` section.
- **Versions:** 0.34.1 in package.json, package-lock.json and plugin.json.
- **Lasting decisions:** none beyond the topic docs above.

### Task 1: command position in `bindsAsCommand` (criteria 1–3, F39)

**Files:** Modify `lib/worktree.ts` · Test `tests/worktree.test.ts`
**Interfaces:** unchanged (`bindsAsCommand(seg: string[]): boolean`, private)

- [x] Write the failing test `callChanges: with a blind part, source after a glued function header or a command prefix's options counts every target`. Its fixture is the one in the existing "count only in a command position" test (`blind: ["a"]`, cwd `/ws`). It asserts `["$S/x"]` for each of these commands:
  - `f(){ . ./env; }; echo > $S/x`
  - `f()(source ./env); echo > $S/x`
  - `command -p source ./env; echo > $S/x`
  - `time -p . ./env; echo > $S/x`
  - `command -- eval x; echo > $S/x`
- [x] Write the failing test `callChanges: with a blind part, command -v and STARTERS or ) as arguments don't bind`. It asserts `[]` for:
  - `command -v source > $S/x`
  - `grep -rn "time" . > $S/x`
  - `rg "(A|B)" . > $S/x`

  and `["$S/x"]` (already passing) for:
  - `case x in a) . ./env;; esac; echo > $S/x`
  - `case x in a) true;; b) . ./env;; esac; echo > $S/x`
  - `if true; then . ./env; fi; echo > $S/x`
  - `"source" ./env; echo > $S/x`
- [x] Run `node --test tests/worktree.test.ts` → expect FAIL in the first test (each new case returns `[]`) and in the second test on the `grep`/`rg` cases (they return `["$S/x"]`).
- [x] Implement `bindsAsCommand` with the following state:
  - **`start`** (the next word is a command word) and **`pattern`** (after `case WORD in`, the next word is a `case` pattern).
  - **In a command position:**
    - STARTERS set `start`, and so does a token that is only an operator stripped to `""`;
    - an assignment keeps `start`;
    - `command`/`time`/`exec` keep `start` across dash options and `--`; `command -v` or `-V` clears it;
    - a token ending in `(`, `{` or `)` sets `start`;
    - the text after the last `(` or `{` inside a token is judged as the command word;
    - `case` arms the `pattern` state.
  - **In a pattern position:** a token ending in `)` sets `start`.
  - **Anywhere else:** a word changes nothing.
  - **STARTERS:** drop `{`, `(`, `!` and `;;`, which never match (F39).
- [x] Run `node --test tests/worktree.test.ts` → expect PASS, then the full suite.
- [x] Commit `fix(verify): source after a glued function header or a prefix's options counts; arguments don't start a command`.

### Task 2: a lookup that ran out of time, and `holdBack` (criterion 4, S22, F28)

**Files:** Modify `lib/reviews.ts`, `lib/hooks.ts` · Test `tests/reviews.test.ts`, `tests/hooks.test.ts`
**Interfaces:** Produces `holdBack(projectDir, rev, ids, root?, deadline?, failed?: string): string | undefined`. `failed` is the caller's own `recordVerdict` result for `rev`. When it is a `Reviewed HEAD <rev> …` message, `rev` isn't looked up again.

- [x] Write the failing test `recordVerdict: a commit not found because a repository didn't answer in time says so, not "is not a commit"`.
  - Setup: a workspace with `a` and its clone `c`; `slowGit(c, "rev-parse", 8)`; `a` hangs as well, so nothing is found.
  - Assert: the result matches `/could not be searched in time/` and doesn't match `/is not a commit/`.
- [x] Write the failing test `holdBack: given the caller's timed-out lookup, it holds each HEAD without searching again and reports the miss`.
  - Setup: `slowGit(c, a.head, 8)` hangs only the SHA lookup in `c`; `failed` is the message from the previous test's shape.
  - Assert, with a 2 s deadline: `holdBack` returns a string matching `/in time/`, `readReviews(join(ws, "c"))[0].verdict` is `Inconclusive` (its HEAD was held), and the call took less than 2 s.
- [x] Rework the test "…times out again is named" (F37): hang only the SHA (`slowGit(c, a.head, 8)`) and assert the HEAD fallback ran. Run it on the parent commit's code and expect FAIL.
- [x] Run `node --test tests/reviews.test.ts` → expect FAIL on these three.
- [x] Implement:
  - `recordVerdict` returns ``Reviewed HEAD ${rev} could not be searched in time in ${here(projectDir)}`` when `found` is empty and `!complete`.
  - `holdBack` skips the `rev` lookup when `failed` starts with `Reviewed HEAD ${rev} `.
  - After the HEAD fallback, `holdBack` returns the "could not be searched in time" text (joined with the HEADs' own miss) whenever the `rev` search was incomplete.
- [x] In `lib/hooks.ts` subagentStop's unverified path, pass `held` as `failed`. Write a hooks test first: an unverified review naming a SHA, with `slowGit(c, sha, 8)`. It must leave `c`'s HEAD Inconclusive and warn within the hook's timeout. Expect it to FAIL on the old code.
- [x] Run the full suite → PASS. Commit `fix(review-gate): a commit not searched in time holds each HEAD back without a second search`.

### Task 3: the store path inside the deadline (criterion 5, S23)

**Files:** Modify `lib/reviews.ts` · Test `tests/reviews.test.ts`
**Interfaces:** Produces `reviewsDir(projectDir, root?, deadline?)`, unchanged for callers that pass no deadline. Adds a private `repoStore(repo, root, deadline): string | undefined`: `undefined` when `--git-common-dir` gives no answer.

- [x] Write the failing test `recordVerdict: a repository whose store can't be resolved in time is a miss, not a write to a folder-keyed store`.
  - Setup: `slowGit(c, "--git-common-dir", 8)` and a 3 s deadline.
  - Assert: the result's `missed` is set; nothing is written under `reviewsDir(join(ws, "c"), root)` as resolved with the real git after `restore`, nor under the folder-keyed hash of `c`; the call took less than 3.5 s.
- [x] Run → expect FAIL: the call blocks for 5 s and writes under the folder key.
- [x] In `recordVerdict`, use `repoStore(repo, root, extra.deadline)`. On `undefined`, set ``failure ??= `${repo} store could not be resolved in time` `` and `continue`.
- [x] Run the full suite → PASS. Commit `fix(review-gate): resolve each repository's store within the deadline`.

### Task 4: SubagentStop's ledger after the gate (criterion 6, F36, F37 hooks)

**Files:** Modify `lib/hooks.ts`, `lib/workdocs.ts` (`currentBranch(dir, timeout?)`) · Test `tests/hooks.test.ts`
**Interfaces:** Produces `currentBranch(projectDir: string, timeout?: number)`, unchanged for callers that pass none.

- [x] Write the failing test `SubagentStop: a hanging branch lookup doesn't cost the review gate its deadline`.
  - Setup: `slowGit(c, "branch --show-current", 20)` and a workspace whose verdict misses `c` (the three-lookup unverified path, F37).
  - Assert: the hook returns its warning in less than 9 s, and `c` is held Inconclusive.
- [x] Run → expect FAIL: more than 9 s, or no hold-back.
- [x] Implement:
  - `subagentStop` starts `deadline` at entry; its gate work moves into `reviewerStop(input, env, deadline)`.
  - `recordUsage(env, input, "subagent", entry + HOOK_BUDGET_MS)` runs after it on every path. `HOOK_BUDGET_MS = 9000`, inside the 10 s hook timeout.
  - `recordUsage` passes the time left to `currentBranch` and skips the ledger when none is left.
- [x] Run the full suite → PASS. Commit `fix(hooks): SubagentStop updates the token ledger after the review gate, inside the hook's time`.

### Task 5: docs and 0.34.1 in eng-kit (criteria 10–11)

**Files:** Modify `lib/worktree.ts` (JSDoc), `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`

- [x] Do the Post-implementation items for eng-kit.
- [x] Run `node .github/release.ts check` → `release metadata ok: 0.34.1`; run `claude plugin validate .` → valid.
- [x] Commit `docs: workspace gates follow-ups (0.34.1)`.

### Task 6: the other edition

- [x] The shared files and their tests are copied byte-identical in the other edition's own PR; `cmp` → identical.

## Progress

- Baseline (eng-kit 44afccd): typecheck clean; `npm test` 602 tests, 591 pass, 11 skipped, 0 fail.
- Ruling: `movesOrBinds` reads a token's word after its last `(`/`{` too (shared `wordOf`). Reason: `f()(source ./env)` never reached `bindsAsCommand` otherwise. Cost if wrong: `X=$(source env)` counts targets like a plain `source`, a false re-fire, not a miss.
- Ruling: the reworked F37 test asserts that `c`, whose SHA lookup hangs, gets no record while `a` is held. The plan said "the HEAD fallback ran", which is wrong for a commit that was found. RED by mutation: `holdBack` returning `undefined` for a miss → FAIL.
- Ruling: a lookup with a deadline leaves `STORE_RESERVE_MS` (1 s) of it for the stores. Found when Task 3 turned a full run red: a hanging repository used the whole deadline, and the stores of the repositories that had the commit got no time. Test "a commit found in one repository is recorded there even when another repository uses up the lookup's time", RED with the reserve set to 0.
- Ruling: `slowGit` takes several patterns. The Task 4 test hangs every lookup of the gate and the ledger's branch lookup in one repository, so the old code (11.4 s) and the new (8.4 s) differ clearly; two nested stand-ins were flaky under load.
- Ruling: `HOOK_BUDGET_MS` = 8000, not 9000. Reason: the 10 s hook timeout also covers node's start.
- Task 1: complete (44afccd..7cd2c02, `npm test` → 604/593 pass, 0 fail).
- Task 2: complete (7cd2c02..2e420b4, `npm test` → 607/596 pass, 0 fail).
- Task 3: complete (2e420b4..0f4943b, `npm test` → 609/598 pass, 0 fail).
- Task 4: complete (0f4943b..b4281e2, `npm test` → 610/599 pass, 0 fail; the old hooks.ts fails the new test).
- Task 5: complete (b4281e2..47ec9a7, `npm test` → 610/599 pass, 0 fail; `release.ts check` ok 0.34.1; `claude plugin validate .` passed).
- Task 6: complete (the shared files copied byte-identical; the other edition's suite green).
- Review round 1 (With fixes): the narrowed command position missed `function f {`, `f () {`, a spaced case `)` and an assignment's substitution, and `wordOf` in `movesOrBinds` turned off a known variable's expansion after `$(. …)` in an argument (fixed, tests added; the ruling on `wordOf` above is withdrawn); the timing tests leaned on a sub-second share for a healthy repository (given room; "no second search" proven from the stand-in git's log; two parallel full runs green); `holdBack` started a lookup with less than the store reserve left (now "no time was left"); the store path is built once; README's hold-back order; `command -V` and the review-focus binding words are tested. Deferred to Follow-ups: a store failure for a commit only one repository has still sends a foreground reviewer back for its lines (pre-existing for a write failure); the ledger's own store path (`git rev-parse --git-common-dir`) isn't bound by the hook's time.
- User ruling (2026-11-03, "Переосмыслить разбор"): after round 2 found new misses (S30) in the narrowed reader, `bindsAsCommand` reads the whole command, takes brackets, `$(`, `${` and backticks from the quote-blanked text with a stack for what each opening one hid, and restarts the command position after a closing one with no opening one; the case-pattern counting and the per-segment depth went. A lone bracket in quotes is data now (F51 closed), `shellWriteTargets` doesn't expand a variable when the reader finds a binding (S31), and `builtin` keeps the position across its options.
