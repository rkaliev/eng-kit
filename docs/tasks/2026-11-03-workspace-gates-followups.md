# Workspace gates: close the open review findings of 0.34.0

Status: design approved (2026-11-03)
Base: a45e681
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

- Guard in a workspace, with S18 (non-Yes verdicts mirrored into the folder store).
- Token ledger and kit-init command detection in a workspace.
- Round-5 carried items listed under Out of scope.

## Plan

None yet

## Progress

None yet
