# Review gate covers the whole branch, open PRs and a read-only reviewer

Status: design approved (2026-10-01)
Base: 65250510d38f19de66fc9d051c777cede8cad4e5 (pi edition: 5294f9a92ba1250d8345b2ef97da7064119c89fc)
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
7. **assumed:** PreToolUse inside a subagent carries `agent_type`. If the live probe disproves it, criterion 6 becomes a documented limit and the user is told before the plan continues.

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

- `agent_type` missing in subagent PreToolUse → the live probe comes first in the plan, see Decision 7.
- `gh pr create` succeeding is read from PostToolUse (success only, failures go to PostToolUseFailure, verified in 0.2.x) → covered by a hooks test.
- A longer prompt for the reviewer → the Bounded path still uses the same template; the size is checked in review.

## Follow-ups

- Optional AI review check in CI (`ci-quality-gates` template, head-SHA check, same reviewer prompt, user's consent).
- The kit's own `reviewer` agent for pi-subagents (read-only tools, model), if pi-subagents lets a project override the built-in one.

## Plan

None yet

## Progress

None yet
