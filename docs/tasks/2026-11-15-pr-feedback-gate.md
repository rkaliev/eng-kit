# Stop the agent calling a PR ready while review feedback is unanswered

Status: design approved (2026-11-15)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: eng-kit 130db5d106daaf758b42d5038a9536faff7562a9 · pi 43fadb73951f448fb2e5ba9be2b049aae6b026b2
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
| 4 | A reviewer whose latest review is CHANGES_REQUESTED yields one open `changes-requested` item; an approval with an empty body yields none | unit |
| 5 | `prFeedback.ignore` in `.claude/guard.json` drops items by author login or by a regex on the text; an invalid regex is reported, not thrown, and drops nothing | unit |
| 6 | `scripts/pr-state.ts` prints the JSON contract in Design, exits 0 with no open items, 1 with open items, 2 when facts can't be collected, with the reason in `error` | unit with a fake `gh` on `PATH` |
| 7 | A successful push to a branch, `gh pr create`, `gh pr comment`, `gh pr review` or a POST `gh api` call to a PR's comments in a prompt makes that prompt's Stop collect feedback for the branch; a new prompt clears it | hook tests |
| 8 | Without such a call in the prompt, Stop runs no `gh` command | hook test (fake `gh` records calls) |
| 9 | Open items whose ID set differs from the last one the agent was sent back for → Stop blocks once, listing author, `file:line`, URL and an excerpt per item and pointing to receiving-code-review | hook test |
| 10 | The same open set again → no block; a `systemMessage` tells the user the PR is not ready with N open items | hook test |
| 11 | No `gh`, no auth, network or API error, PR not found, or the collection budget (≈6 s, inside the 10 s hook timeout) exceeded → no block; one `systemMessage` "PR feedback not checked: <reason>" | hook tests, including a fake `gh` that sleeps |
| 12 | The PR gate's reason joins the verify gate's and the task-file gates' reasons in one block; `stop_hook_active` skips it | hook test |
| 13 | `prFeedback.enabled: false` turns the gate off; the guard already asks before `.claude/guard.json` changes | hook test |
| 14 | The pi edition behaves the same: `lib/pr-feedback.ts` and `scripts/pr-state.ts` byte-identical, the gate wired into pi's end-of-turn mechanism | pi tests mirroring 7–13; `tools/compare-editions.mts` reports no drift for the shared files |
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

None yet

## Progress

None yet
