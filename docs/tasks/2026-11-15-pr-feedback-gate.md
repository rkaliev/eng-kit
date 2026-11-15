# Stop the agent calling a PR ready while review feedback is unanswered

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: eng-kit d42c7a1e14670967bba33f64ccfce67ac0281a9e · pi 43fadb73951f448fb2e5ba9be2b049aae6b026b2
Links: None (workspace analysis of the fortune-os comparison, item "Coverage")

<details><summary>Original request</summary>

что у нас дальше? → мы же по сути сделали харнесы? → давай начнем с того что советуешь

(Design choices, in order: Stop hook gate — "a"; closed = resolved or our login has the last word — "a"; reply owed by everything except explicit exceptions — "a"; facts unavailable → pass with a visible note — "a"; check only when the prompt touched a PR — "a"; design including the top-level-bot rule — "да".)

</details>

## Intent

When the agent pushes to, opens or answers a GitHub PR, it cannot end its turn while review feedback on that PR is unanswered without being sent back once with the list, so "PR ready" rests on facts a script collected, not on the model's self-report.

## Context

receiving-code-review step 8 already asks for one coverage line per review item, but nothing checks it: the kit never reads PR threads, review bodies or comments (no `gh api` call to a PR exists). The kit reviewer's own findings are already covered mechanically: `F<n>` IDs in the review store, re-checked each round, and the review gate passes only `Yes`. So the gap is feedback from people and bots on the hosted PR.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | An inline thread is open unless it is resolved or its last comment is by the authenticated `gh` login | unit, `lib/pr-feedback.ts` fixtures |
| 2 | A non-empty review body not by our login is open unless a comment by our login on the PR follows it | unit |
| 3 | A top-level comment by a human not by our login is open unless a comment by our login follows it; a top-level comment whose author is a `Bot` is not an item | unit |
| 4 | A reviewer whose latest approving or changes-requesting review (GitHub's `latestOpinionatedReviews`; a later COMMENTED review doesn't clear it) is CHANGES_REQUESTED yields one open `changes-requested` item; an approval with an empty body yields none | unit |
| 5 | `prFeedback.ignore` in `.claude/guard.json` drops items by author login or by a regex on the text; an invalid regex is reported, not thrown, and drops nothing | unit |
| 6 | `scripts/pr-state.ts` prints the JSON contract in Design, exits 0 with no open items, 1 with open items, 2 when facts can't be collected, with the reason in `error` | unit with a fake `gh` |
| 7 | A successful push to a branch, `gh pr create`, `gh pr comment`, `gh pr review` or a POST `gh api` call to a PR's comments in a prompt makes that prompt's Stop collect feedback for the branch; a new prompt clears it | hook tests |
| 8 | Without such a call in the prompt, Stop runs no `gh` command | hook test (fake `gh` records calls) |
| 9 | Open items whose ID set differs from the last one the agent was sent back for → Stop blocks once, listing author, `file:line`, URL and an excerpt per item and pointing to receiving-code-review | hook test |
| 10 | The same open set again → no block; a `systemMessage` tells the user the PR is not ready with N open items | hook test |
| 11 | No `gh`, no auth, network or API error, PR not found, or the collection budget (≈6 s, inside the 10 s hook timeout) exceeded → no block; one `systemMessage` "PR feedback not checked: <reason>" | hook tests, including a fake `gh` that sleeps |
| 12 | The PR gate's reason joins the verify gate's and the task-file gates' reasons in one block; `stop_hook_active` skips it | hook test |
| 13 | `prFeedback.enabled: false` turns the gate off; the guard already asks before `.claude/guard.json` changes | hook test |
| 14 | The pi edition behaves the same: `lib/pr-feedback.ts` byte-identical with pi's `extensions/lib/pr-feedback.ts`, `scripts/pr-state.ts` identical except its import path, the gate wired into pi's `agent_end` follow-up | pi tests mirroring 7–13; `cmp` and `diff` of the shared files |
| 15 | receiving-code-review step 8 names `pr-state.ts` as the source of the coverage facts; ARCHITECTURE (en, ru), README, `review-gate.md`, CHANGELOG describe the gate, its rules and its limits | skill lint; prose review |

## Scope

**In scope:**
- `lib/pr-feedback.ts` (pure classifier), `scripts/pr-state.ts` (collector CLI), the Stop gate, PostToolUse/UserPromptSubmit state, the `prFeedback` guard config, skill and doc updates, in both editions; release 0.40.0.

**Out of scope:**
- GitLab: the gate stays silent in a repository whose remote isn't GitHub.
- Background watching for feedback that arrives after the turn ends (0.41.0 PR watcher).
- Gating on check status: `checks` is reported as a fact only.
- Writing to the PR: no replies, no resolving threads.
- A behavior eval on a live PR: the eval runner has no GitHub; hook tests carry the evidence.

## Decisions

1. The check is a Stop-hook gate, not skill text or a guard rule on `gh pr ready` (user, 2026-11-15).
2. An item is closed when its thread is resolved or our authenticated login has the last word; review bodies and top-level comments close with a later comment by our login; CHANGES_REQUESTED stands until that reviewer reviews again (user). Agent and user share the `gh` login, so their replies are indistinguishable by design.
3. Every item needs an answer except explicit exceptions: our own messages, empty approvals, top-level comments by `Bot` authors, and `prFeedback.ignore` (user). The bot rule replaces "a bot editing one comment in place": it is a marker, not an intent heuristic, and bot findings still arrive in review bodies and inline threads, which are checked.
4. When facts can't be collected the gate passes and says why, once; the agent may not call the PR ready (user).
5. The gate runs only when the prompt touched a PR, and sends the agent back once per new set of open items (user).
6. GitHub only in this release (**assumed**, matches the roadmap: GitHub first, glab later).
7. `lib/pr-feedback.ts` and `scripts/pr-state.ts` are shared byte-for-byte between the editions, like `scripts/test-hygiene.ts` (**assumed**).
8. No new dependencies; Node ≥22.18 as for the other hooks.

## Design

**Components**
- `lib/pr-feedback.ts`: `classify(response, login, config) → { open: Item[], closed: number, problems: string[] }`. No I/O.
- `scripts/pr-state.ts`: resolves the PR for a branch (`--branch`, else the current one; `--repo <dir>`), runs `gh api user` and one `gh api graphql` query (review threads with resolution and comments, reviews with state and body, issue comments, head SHA, rollup check state) with a deadline, calls `classify`, prints JSON.
- `lib/hooks.ts`: PostToolUse records `prTouched: Array<{ dir, branch }>` in session state from the existing landing parser; UserPromptSubmit clears it; Stop calls the collector in-process with the remaining budget and adds a reason or a `systemMessage`. State keeps `prFeedbackSent` (hash of the open IDs last sent back) and `prFeedbackNoted`.

**Item**: `{ id, kind: "thread" | "review" | "comment" | "changes-requested", author, path?, line?, url, excerpt }`; the excerpt is the first 200 characters of the item's text on one line.

**`pr-state.ts` output**
```json
{ "pr": 48, "url": "…", "head": "<sha>", "login": "<login>",
  "open": [ { "id": "…", "kind": "thread", "author": "…", "path": "a.ts", "line": 12, "url": "…", "excerpt": "…" } ],
  "closed": 7, "checks": { "state": "SUCCESS", "failed": [] }, "problems": [], "error": null }
```

**Config** (`.claude/guard.json`): `"prFeedback": { "enabled": true, "ignore": [ { "author": "sonar-user" }, { "pattern": "^/deploy" } ] }`.

**Errors**: every collection failure becomes `error` (exit 2) and the gate's note; nothing throws out of Stop.

**Security**: feedback text is untrusted data; the block reason quotes excerpts as data and tells the agent so. No token is read or printed; `gh` holds the credentials.

## Rollout

Minor release 0.40.0 in both editions, on by default. A user who doesn't want it sets `prFeedback.enabled: false`. Rollback: the previous release.

## Risks and open questions

- pi's end-of-turn hook may not allow a send-back the way Claude Code's Stop does → check in planning; if it can't, pi reports via a notice and the plan says so.
- A slow GitHub API eats the Stop budget shared with the task-file reminders → the collector gets its own deadline and fails open.
- GraphQL pagination (a PR with >100 threads or comments) → fetch the first page of each with the highest page size and report a `problems` entry when more exist, rather than paginate within the hook budget.

## Follow-ups

- 0.41.0 PR watcher on top of `pr-state.ts`: background, one JSON event, head-SHA check, `--ack` dedup.
- systematic-debugging control case (run the failing test on the base commit), hypotheses×facts matrix, cheapest-layer-first; with an eval.
- ci-quality-gates: cheap code gate before AI review, full gate as the single required check.
- GitLab support for `pr-state.ts` (`glab`).

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** a Stop-hook gate (and pi `agent_end` follow-up) that sends the agent back once when a GitHub PR it touched this prompt has unanswered review feedback, built on a shared collector `pr-state.ts`.
**Architecture:** `lib/pr-feedback.ts` holds a pure classifier and a synchronous collector (one `gh api graphql` call via `spawnSync` with a timeout), shared byte-for-byte with pi. Each edition detects PR-touching shell calls in its own `reviews.ts`, keeps `prTouched` per prompt, and runs the collector at the end of the turn. `scripts/pr-state.ts` is a thin CLI over the same lib.
**Stack / constraints:** Node ≥22.18 running `.ts` directly, `node:test`, TypeScript 5.9.3, no new dependencies; `gh` is an external binary, never bundled. Hook timeout 10 s; task-file reminders take up to 3 s (`TASK_FILE_BUDGET_MS`); the collector's deadline is `min(6000, 9000 − elapsed)` ms from the Stop handler's start. Files the agent writes are English. Commits have no Co-Authored-By or other trailers.
**Verification:** in each repo `npm test` and `npm run typecheck` (or `node <kit>/scripts/verify.ts`); eng-kit also `npm run validate`.

### Review focus
1. A PR with more than one page of threads, reviews or comments: `problems` names it, nothing throws (Task 1).
2. A thread the reviewer replied to after our reply re-opens, with a new item ID so the gate fires again (Task 1).
3. `gh` that hangs: the collector returns `error: "timed out"` inside its deadline and Stop still returns within the hook timeout (Tasks 2, 4).
4. A push in a non-GitHub repository: no block and no note (Task 4).
5. Feedback text containing instructions: the block reason marks excerpts as untrusted data and strips newlines (Task 4).

### Post-implementation
- `docs/ARCHITECTURE.md` and `.ru.md`: a "PR feedback gate" part under "Review and after push" (rules, triggers, fail-open, limits) and the hook list in §3. This is the topic chapter.
- `README.md`: one line in the hooks/gates list and the `prFeedback` config keys.
- `skills/receiving-code-review/SKILL.md` step 8 and `skills/requesting-code-review/references/review-gate.md`: name `pr-state.ts` and the gate.
- `skills/git-workflow/SKILL.md` "after push": run `pr-state.ts` before calling a PR ready.
- `CHANGELOG.md` 0.40.0 in both repos; version 0.40.0 everywhere 0.39.1 is pinned (package.json, package-lock.json, plugin.json, bug_report.yml, tests that pin it; pi also README, GETTING-STARTED en/ru, templates/settings.json).
- pi: the same docs in `src/` (ARCHITECTURE en/ru, README, the skills).
- `docs/decisions/`: none: the kit keeps decisions in the task file and ARCHITECTURE.
- Private workspace `docs/FRAMEWORK-SOURCES.ru.md`: add the source (fortune-os `pr-resolve` §6.3) after merge.

### Files

| File | Responsibility |
|---|---|
| `lib/pr-feedback.ts` (new; pi `extensions/lib/pr-feedback.ts`, identical) | `classify`, `collectPrState`, the GraphQL query, types |
| `scripts/pr-state.ts` (new, both repos) | CLI: args → `collectPrState` → JSON, exit 0/1/2 |
| `lib/reviews.ts` (pi `extensions/lib/reviews.ts`) | `touchedPrs(command, cwd)`: which PR branches a shell call touched |
| `lib/state.ts` | `prTouched`, `prFeedbackSent`, `prFeedbackNoted` on `SessionState` |
| `lib/patterns.ts` (both) | `prFeedback?: { enabled?: boolean; ignore?: Array<{ author?: string; pattern?: string }> }` on `GuardConfig` |
| `lib/hooks.ts` | PostToolUse records, UserPromptSubmit clears, Stop gates; `HookEnv.gh?: string` |
| `src/extensions/verify.ts` | the same three steps in pi's `tool_result`, `input`, `agent_end` |
| `tests/pr-feedback.test.ts` (new, both), `tests/hooks.test.ts`, `src/tests/extensions.test.ts` | tests |

### Task 1: classifier

**Files:** Create `lib/pr-feedback.ts` · Test `tests/pr-feedback.test.ts`
**Interfaces:** Produces
`type ItemKind = "thread" | "review" | "comment" | "changes-requested"`,
`interface Item { id: string; kind: ItemKind; author: string; path?: string; line?: number; url: string; excerpt: string }`,
`interface FeedbackConfig { ignore?: Array<{ author?: string; pattern?: string }> }`,
`classify(pr: PrData, login: string, config?: FeedbackConfig): { open: Item[]; closed: number; problems: string[] }`,
where `PrData` is the `repository.pullRequests.nodes[0]` shape of the query in Task 2 (threads with `isResolved`, `path`, `line`, `comments(last: 1)`; `reviews(last: 100)`; `latestOpinionatedReviews(first: 100)`; `comments(last: 100)`; each connection with `totalCount`; authors `{ login, __typename }`).

- [x] Write failing tests with a fixture builder, one per rule:
  - `thread: open unless resolved or our login has the last word` (crit. 1): resolved → closed; last comment by `me` → closed; last by `alice` → open item `{ kind: "thread", path, line, author: "alice" }`.
  - `thread: a reply after ours re-opens it with a new id`: id is `<threadId>:<lastCommentId>`.
  - `review body: open until a later comment by us` (crit. 2): body by `alice` at t1; our issue comment at t0 → open; at t2 → closed; empty body → no item; review by `me` → no item.
  - `top-level comment: human open, bot never an item` (crit. 3): `__typename: "Bot"` → no item; human `bob` without a later comment by `me` → open.
  - `changes requested stands until that reviewer reviews again` (crit. 4): `latestOpinionatedReviews` CHANGES_REQUESTED by `carol` → one `changes-requested` item id `changes-requested:carol`; APPROVED with empty body → no item.
  - `ignore drops by author, by pattern, by both` (crit. 5); `an invalid pattern is a problem and drops nothing`: `problems` contains `prFeedback.ignore pattern "(" is not a valid regular expression`.
  - `more than one page is a problem`: `totalCount` above the nodes length → `problems` names the connection (`reviewThreads: 140 of which 100 read`).
  - `excerpt is one line, at most 200 characters`.
  - `closed counts every item that was an item but is closed`.
  Add a stub `classify` returning `{ open: [], closed: 0, problems: [] }`.
- [x] Run `node --test tests/pr-feedback.test.ts` → expect FAIL on the assertions (e.g. expected 1 open item, received 0).
- [x] Implement `classify`. "Later" compares `createdAt`/`submittedAt` ISO strings. A comment by our login counts for review bodies when it is an issue comment or a review by us with a non-empty body.
- [x] Run `node --test tests/pr-feedback.test.ts` → PASS; `npm test`, `npm run typecheck` → PASS.
- [x] Commit `feat(pr-feedback): classify PR review feedback`.

### Task 2: collector and `pr-state.ts`

**Files:** Modify `lib/pr-feedback.ts` · Create `scripts/pr-state.ts` · Test `tests/pr-feedback.test.ts`
**Interfaces:** Consumes `classify` · Produces
`interface PrState { pr: number | null; url: string | null; head: string | null; login: string | null; open: Item[]; closed: number; checks: { state: string | null; failed: string[] }; problems: string[]; error: string | null; github: boolean }`,
`collectPrState(opts: { dir: string; branch?: string; deadlineMs: number; gh?: string; config?: FeedbackConfig }): PrState` (never throws),
CLI `node scripts/pr-state.ts [--repo <dir>] [--branch <name>]`.

- [x] Write failing tests with a fake `gh` (a `#!/bin/sh` script in a temp dir that appends its args to `calls.txt`, prints `response.json` and exits with `$FAKE_GH_CODE`, or sleeps when asked):
  - `collects in one gh call` : exactly one call, `api graphql` with `-F owner={owner} -F name={repo} -F branch=<branch>`; the result's `login` comes from `viewer.login`, `head` from the last commit's `oid`, `checks.failed` lists failed check names.
  - `branch defaults to the current branch of dir` (a temp git repo on `feat/x`).
  - `error cases` (crit. 11 inputs): `gh` missing → `error: "gh not found"`; exit 4 with `auth` on stderr → `"gh is not authenticated"`; other non-zero → `"gh failed: <first stderr line>"`; no open PR → `"no open PR for branch feat/x"`; over the deadline → `"timed out after <n> ms"`.
  - `not GitHub`: stderr `none of the git remotes configured for this repository point to a known GitHub host` → `github: false`, `error` set.
  - CLI (crit. 6): exit 0 / 1 / 2 for no open / open / error, stdout parses as `PrState`.
  Stub `collectPrState` returning an error state.
- [x] Run `node --test tests/pr-feedback.test.ts` → FAIL on the assertions.
- [x] Implement with `spawnSync(gh, args, { cwd: dir, timeout: deadlineMs, encoding: "utf8" })`; `ENOENT` → not found, `ETIMEDOUT`/signal → timed out. Read `prFeedback` from `.claude/guard.json` in the CLI only when `config` isn't passed (the hook passes its own).
- [x] Run the tests → PASS; full suite and typecheck → PASS.
- [x] Commit `feat(pr-state): collect PR feedback facts with gh`.

### Task 3: which calls touch a PR

**Files:** Modify `lib/reviews.ts`, `lib/state.ts`, `lib/hooks.ts` · Test `tests/reviews.test.ts`, `tests/hooks.test.ts`
**Interfaces:** Produces `touchedPrs(command: string, cwd: string): Array<{ dir: string; branch?: string }>` (deduplicated, at most 3); `SessionState.prTouched?: Array<{ dir: string; branch?: string }>`.

- [x] Write failing tests (crit. 7):
  - `touchedPrs`: `git push` → `[{ dir: cwd }]`; `git push origin HEAD:feat/y` → branch `feat/y`; `git push -u origin feat/z` → `feat/z`; `gh pr create --head feat/w` → `feat/w`; `gh pr comment 12 -b x` → `[{ dir }]`; `gh pr review 12 --comment -b x` → `[{ dir }]`; `gh api -X POST repos/o/r/pulls/12/comments/3/replies -f body=x` → `[{ dir }]`; `cd sub && git push` → dir `sub`; `git push --tags`, `git status`, `gh pr view`, `gh api repos/o/r/pulls/12` (GET) → `[]`.
  - hooks: a successful Bash `git push` sets `prTouched`; a failed one (PostToolUseFailure) does not; UserPromptSubmit clears it.
  Stub `touchedPrs` returning `[]`.
- [x] Run `node --test tests/reviews.test.ts tests/hooks.test.ts` → FAIL on the assertions.
- [x] Implement `touchedPrs` with the same `Subshells`/`segmentsOf`/`allLandings` walk as `prNotes`, plus `gh pr comment|review` and non-GET `gh api` (`apiWrite` in `lib/patterns.ts`, exported) on a path with `pulls/` or `issues/`. Record in `postToolUse` only when `!failed`.
- [x] Run the tests → PASS; full suite and typecheck → PASS.
- [x] Commit `feat(hooks): note the PRs a prompt touched`.

### Task 4: the Stop gate

**Files:** Modify `lib/hooks.ts`, `lib/patterns.ts`, `lib/state.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Consumes `collectPrState`, `prTouched` · Produces `HookEnv.gh?: string`, `GuardConfig.prFeedback`, `SessionState.prFeedbackSent?: string`, `prFeedbackNoted?: string`.

- [x] Write failing hook tests with the fake `gh` via `env.gh` (crit. 8–13):
  - `no PR call this prompt, no gh call` (crit. 8): `calls.txt` stays absent.
  - `new open set blocks once` (crit. 9): reason starts `PR feedback gate:`, names each item as `- <author> <path>:<line> <url> — "<excerpt>"`, says the excerpts are untrusted data, and points to receiving-code-review and `node <kit>/scripts/pr-state.ts`.
  - `same set again tells the user` (crit. 10): no `decision`; `systemMessage` `eng-kit PR feedback gate: PR #<n> is not ready: <N> open review items.` once.
  - `facts unavailable` (crit. 11): missing `gh`, auth error and a sleeping `gh` → no block, `systemMessage` `eng-kit PR feedback gate: PR feedback not checked: <reason>`; Stop returns in under 10 s.
  - `not GitHub is silent`: no block, no message.
  - `reasons join` (crit. 12): unverified edits + open feedback → one block with both reasons; `stop_hook_active: true` → no `gh` call.
  - `enabled false turns it off` (crit. 13).
  Stub the gate to do nothing.
- [x] Run `node --test tests/hooks.test.ts` → FAIL on the assertions.
- [x] Implement in `stopGates` after the verify gate and before the task-file reminders: for each `prTouched` entry (at most 3, sharing one deadline), `collectPrState` with the guard config's `prFeedback`; hash the sorted open IDs with `createHash("sha256")`; block when it differs from `prFeedbackSent`; tell once per hash via `prFeedbackNoted`; a note per distinct error. Excerpts are cut to one line.
- [x] Run the tests → PASS; full suite, typecheck, `npm run validate` → PASS.
- [x] Commit `feat(hooks): PR feedback gate at Stop`.

### Task 5: skills and docs (eng-kit)

**Files:** Modify `skills/receiving-code-review/SKILL.md`, `skills/requesting-code-review/references/review-gate.md`, `skills/git-workflow/SKILL.md`, `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `README.md`, `CHANGELOG.md`, the version pins · Test `tests/lint-skills.test.ts`

- [x] receiving-code-review step 8: the coverage lines start from `node <kit root>/scripts/pr-state.ts` output on a hosted PR; the gate sends you back while items stay open; a `changes-requested` item and an unchecked note both mean "not ready". Keep the skill within the lint's word limit, trimming nothing else.
- [x] git-workflow "after push" and `review-gate.md`: one sentence each, as Post-implementation lists.
- [x] ARCHITECTURE en/ru, README, CHANGELOG 0.40.0, version 0.40.0 in every pin found by `grep -rl 0.39.1` (excluding CHANGELOG and lockfile entries of other packages).
- [x] Run `npm test` (lint-skills included), `npm run typecheck`, `npm run validate` → PASS.
- [x] Commit `docs: PR feedback gate, 0.40.0`.

### Task 6: pi port

**Files:** Create `src/extensions/lib/pr-feedback.ts` (copy), `src/scripts/pr-state.ts` · Modify `src/extensions/lib/reviews.ts`, `src/extensions/lib/patterns.ts`, `src/extensions/verify.ts`, pi skills and docs as in Task 5 · Test `src/tests/pr-feedback.test.ts` (copy, import path adapted), `src/tests/extensions.test.ts`, `src/tests/reviews.test.ts`

- [x] Copy the lib and its tests; port `touchedPrs` with tests (pi's `prNotes` shows how pi walks a command).
- [x] Write failing extension tests mirroring Task 4: `agent_end` follow-up (`customType: "verify-gate"`, one message carrying both reasons), the `ctx.ui.notify` note for the same set and for errors, `input` clearing, `.pi/guard.json` `prFeedback.enabled: false`. pi has a UI check: without `ctx.hasUI` notes are skipped, the follow-up still goes out.
- [x] Run `node --test tests/extensions.test.ts` → FAIL on the assertions; implement in `verify.ts` (`gh` path injectable as the tests inject other paths); → PASS.
- [x] pi docs, skills, CHANGELOG, version pins as Task 5.
- [x] `cmp src_claude/lib/pr-feedback.ts src/extensions/lib/pr-feedback.ts` → no output; `diff src_claude/scripts/pr-state.ts src/scripts/pr-state.ts` → only the import line (crit. 14).
- [x] Run `npm test`, `npm run typecheck` in `src/` → PASS.
- [x] Commit `feat: PR feedback gate, 0.40.0` in `src/`.

## Progress

- Baseline (eng-kit 1541bfc): `npm test` → 835 tests, 824 pass, 11 skipped, 0 fail; `npm run typecheck` → clean. No drift since d42c7a1 in lib/, scripts/, tests/.
- Ruling: the pagination problem reads `reviewThreads: 1 of 140 read` instead of the plan's `140 of which 100 read` — plainer English — none.
- Ruling: `ignore` drops a `changes-requested` item by author only (it has no text) — it carries no reviewer text to match — a pattern rule can't silence it.
- Task 1: complete (1541bfc..0aadfb1, `node --test tests/pr-feedback.test.ts` → 11 pass; `npm test` → 846 tests, 835 pass, 11 skipped, 0 fail; typecheck clean)
- Ruling: the CLI reads `prFeedback` from `.claude/guard.json`, else `.pi/guard.json`, at the git top level — keeps `scripts/pr-state.ts` identical across editions except its import — a pi user with both files gets the Claude one.
- Ruling: the folder install's script allowlist (`lib/install.ts`) gains `pr-state`, with `tests/install.test.ts` expecting it and `lib/pr-feedback.ts` — the plan missed that the project install copies scripts by name — none.
- Task 2: complete (ba4e9fd..2ff8f6a, `node --test tests/pr-feedback.test.ts` → 16 pass; `npm test` → 851 tests, 840 pass, 11 skipped, 0 fail; typecheck clean)
- Ruling: the `cd sub && git push` case moved to its own test with a real folder — the guard's folder tracking refuses a `cd` into a folder that doesn't exist, so `/repo/sub` fell back to `cwd` — none; regression-proved by reverting `shell.dir ?? cwd` to `cwd` (FAIL) and restoring (PASS).
- Ruling: `touchedPrs` also skips tag refspecs (`refs/tags/…`) and deletions (`:branch`), and handles `+refs/heads/…` — a tag or deletion has no PR to check — none.
- Task 3: complete (2ff8f6a..9205511, `node --test tests/reviews.test.ts` → 118 pass; `npm test` → 855 tests, 844 pass, 11 skipped, 0 fail; typecheck clean)
- Ruling: a branch with no open PR is silent, like a non-GitHub repository, instead of criterion 11's "PR not found → note" — every push of a work branch before its PR is opened would otherwise print a note — a mistyped branch name goes unreported. **Needs the user's confirmation.**
- Ruling: the gate runs after the task-file reminders, not before them — it gets what the other gates left of the 10 s hook, capped at 6 s and ending 9 s after Stop started — none.
- Ruling: the four negative gate tests (no PR call, silent no-PR/non-GitHub, `enabled: false`, `ignore`) pass without the gate by nature; each was proved by a mutation that made it FAIL, then restored.
- Ruling: under `stop_hook_active` the gate checks nothing (criterion 12), so after a send-back the user sees no "not ready" note in that same prompt; the agent's coverage report carries it.
- Task 4: complete (f911681..08d1778, `node --test tests/hooks.test.ts` PR feedback tests → 9 pass; `npm test` → 863 tests, 852 pass, 11 skipped, 0 fail; typecheck clean; `npm run validate` → passed)
- Ruling: receiving-code-review step 8 was reworded within the step to fit the 800-word body limit ("every required check passed", "Green checks or unchecked feedback aren't enough") — the plan's "trimming nothing else" held: no other step changed — none.
- Ruling: GETTING-STARTED (en, ru) gained a troubleshooting entry for the gate's send-back and "not checked" note — the plan's Post-implementation missed that page — none.
- Task 5: complete (60019ac..3265ead, `node --test tests/lint-skills.test.ts` → 44 pass; `npm test` → 863 tests, 852 pass, 11 skipped, 0 fail; typecheck clean; `npm run validate` → passed)
- pi baseline (pi 43fadb7): `npm test` → 776 tests, 765 pass, 11 skipped, 0 fail; typecheck clean.
- Ruling: the gate's collection loop, send-back text and set hash moved into the shared `lib/pr-feedback.ts` (`checkFeedback`), refactored in eng-kit while green (a335191) — keeps the two editions' gate logic from drifting; each edition keeps only its state and wording prefix (`eng-kit PR feedback gate:` vs pi's `PR feedback gate:`) — none.
- Ruling: pi's `reviews.ts` was identical to eng-kit's at the base, so the eng-kit file was copied (`cmp` identical); pi's `patterns.ts` differs, so `apiWrite` export and `prFeedback` were patched in by hand.
- Ruling: pi's shared-lib tests (`tests/pr-feedback.test.ts`, the `touchedPrs` tests) are copies of eng-kit tests already seen failing there, run against a byte-identical lib — not seen failing again in pi. The pi extension tests were seen failing (5 of 6; the negative one proved by mutation).
- Ruling: in pi the turn that answers any follow-up skips the PR check, mirroring Claude Code's `stop_hook_active`; `prFeedback` in `.pi/guard.json` counts only in a trusted project, like pi's other loosening keys — none.
- Task 6: complete (pi 43fadb7..b71d1d8; `node --test tests/extensions.test.ts` PR feedback → 6 pass; pi `npm test` → 801 tests, 790 pass, 11 skipped, 0 fail; typecheck clean; `cmp lib/pr-feedback.ts` identical; `diff scripts/pr-state.ts` → import line only)
