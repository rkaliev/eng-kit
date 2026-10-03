# The agent pushes its own work branch and opens the PR itself

Status: plan approved (2026-10-03)
Base: 37ae1c771b22e416d745bf1f348adca410e5d79c (pi edition: cbc35c82c7cf0982194fab41169e09a7aead064d)
Links: plan `~/.claude/plans/buzzing-munching-eich.md` · private FRAMEWORK-SOURCES (new §11.19)

<details><summary>Original request</summary>

"а почему ты перестал пуши делать? с делал MR оформи их правильно" → "не пушить это как в fortune os?" → chosen: "Как fortune-os для веток (Recommended)": the agent pushes its own feature branch and opens the PR itself once the review is Yes; merge, push to the base, force and other branches keep asking or are blocked; kit default in both editions.

</details>

## Intent

Like a production team's agent workflow, the agent ships its own work branch to the remote and opens the PR without stopping, while everything that changes shared history or the base still needs the user, and this works from a workspace that holds several repositories.

## Context

Every `git push` asks today because of one rule (`lib/patterns.ts:30`). The review gate already guards landings on the base and on a PR branch the agent opened. From a workspace folder that is not itself a repository, no verdict is ever recorded: `recordVerdict` resolves the SHA in `projectDir` (`lib/reviews.ts:101`), and the gate reads records by `projectDir` (`uncovered(where, projectDir, …)`, `openPrBranches(projectDir, …)`), so `gh pr create` is always refused there.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | No question for a plain push of a non-base branch to a configured remote: `git push`, `git push -u origin feat/x`, `git push origin HEAD`, `git push origin feat/x:feat/x` on branch `feat/x` | unit `tests/guard.test.ts` (both editions) with a temp repo that has `origin/HEAD` |
| 2 | Still asks: a push whose target is the base (`git push origin main`, `HEAD:main`, `git push` on main), detached HEAD, unknown base, a URL or path as remote, `--tags`, `--follow-tags`, `--all`, `--branches`, `--mirror`-less deletes (`--delete`, `-d`, `:x`), `--prune`, `-o`/`--push-option`/`--repo`/`--receive-pack`/`--exec`, `--force-with-lease`, `--force-if-includes`, `gh pr merge`, `glab mr merge`. Still blocks: `--force`, `-f`, `+ref`, `--mirror` | unit `tests/guard.test.ts` |
| 3 | A push to a PR branch the agent opened, and `gh pr create`, pass without a question when the review covers HEAD, and are refused (Claude) / asked (pi) when it does not — unchanged gate behaviour | existing `tests/hooks.test.ts`, `tests/reviews.test.ts`, pi `tests/extensions.test.ts`, expectations updated where they assumed the generic push question |
| 4 | From a project folder that is not a repository, a reviewer's verdict for a commit in a nested repository (one level down) is recorded under that repository, the gate finds it for a landing from that repository (`git -C <repo> …`, `cd <repo> && …`), and `review-log <sha>` run from the folder prints it. A SHA found in two nested repositories is refused as ambiguous | unit `tests/reviews.test.ts`, `tests/hooks.test.ts` (SubagentStop), pi `tests/extensions.test.ts`; live run in this workspace |
| 5 | Skills and docs say: push the work branch and open the PR yourself once the review covers HEAD; merging, pushing to the base and rewriting pushed history stay the user's choice | review checklist; `tests/lint-skills.test.ts` |
| 6 | Both editions behave the same; shared libs stay byte-identical | `cmp` of `reviews.ts`/`workdocs.ts`; `tools/compare-editions.mts` |

## Scope

**In scope:** both editions — `lib/patterns.ts` (pi `extensions/lib/patterns.ts`), `lib/reviews.ts` (shared), `lib/hooks.ts` / pi `extensions/guard.ts` call sites, `scripts/review-log.ts`, tests, skills `git-workflow`, `using-skills`, `executing-plans`, `requesting-code-review/references/review-gate.md` if it states the old rule, README, `docs/*`, `templates/guard.json`, CHANGELOG, version 0.16.0. Workspace: FRAMEWORK-SOURCES §11.19, memory.

**Out of scope:** a server-side AI review, merging by the agent, repositories nested deeper than one level, `git push` with `push.default`/upstream names that differ from the local branch (kept as "asks").

## Decisions

1. fortune-os model for branches (user, 2026-10-03).
2. `--force-with-lease`/`--force-if-includes` keep asking: they rewrite pushed history; git-workflow says "after the user agrees". Stricter than fortune-os (ruling).
3. Anything the classifier can't read with certainty asks (fail to the question, never to silence).
4. Records are keyed by the repository the commit or command belongs to, not by the session folder. A non-repository folder resolves a SHA among its direct child repositories; ambiguity is an error.
5. `templates/guard.json`'s `allow` example for feature pushes is replaced, since that is now the default.

## Design

- `classifyPush(tokens, cwd): "allow" | { confirm: reason }` in `patterns.ts`, used by `checkSegment`/`checkCommand` in place of the regex rule. It follows `git -C <dir>` (and the cwd the guard already tracks), reads options, remote (must be a name in `git remote`), refspecs, current branch and the base via `baseBranch()` from `workdocs.ts`.
- `reviews.ts`: `repoFor(dir, rev?)` → the repository root for `dir`, or, when `dir` is not in a repository, the unique direct child repository containing `rev`. `recordVerdict` resolves through it. `checkReview` passes `where` (the landing checkout) to `uncovered` and `openPrBranches`; `notePr`/`settlePr` key by the command's checkout. `review-log` resolves through `repoFor(process.cwd(), sha)`.

## Rollout

None. After the update the first push of a work branch no longer asks; records written by 0.15.0 under a repository key stay valid.

## Risks and open questions

- A push to the wrong remote branch name through `push.default=upstream` → such forms ask (Out of scope).
- Silencing pushes widens what an injected instruction could do → only own non-base branches to configured remotes, no tags/deletes/force; the base and PR branches stay behind the review gate; CI and branch protection on the server.

## Follow-ups

- Deeper nesting and `push.default`/upstream-aware target resolution.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** criteria 1–6 in both editions.
**Stack / constraints:** kit Node ≥ 22.18, `node --test`, no new dependencies; shared libs byte-identical; no commit trailers.
**Verification:** `npm test`, `npx tsc --noEmit` in each edition.

### Review focus
1. A push form that silently passes but lands on the base or deletes a ref.
2. `git -C`/`cd` tracking for push classification matching the review gate's tracking.
3. A verdict recorded under one repository and read under another (worktrees, subfolders, nested repo).
4. pi: confirm vs block wiring and trusted-project rules unchanged.

### Post-implementation
README guard table; `docs/ARCHITECTURE*.md`, `GETTING-STARTED*`, `WALKTHROUGH*` lines that say push asks; CHANGELOG 0.16.0 + version fields; FRAMEWORK-SOURCES §11.19; memory.

### Task 1: Push classifier
**Files:** `lib/patterns.ts`, pi `extensions/lib/patterns.ts` · Test `tests/guard.test.ts` (both)
- [ ] Write the criterion 1–2 matrix as tests against a temp repo (bare `origin` with `origin/HEAD` → main, a feature branch, a detached state, a repo without `origin/HEAD`); run → the "no question" cases FAIL with `confirm`.
- [ ] Implement `classifyPush`, replace the regex rule, add `gh pr merge`/`glab mr merge` confirm. Update existing expectations that assumed a question for a feature push (guard.test.ts:44, hooks.test.ts:42/53/289/479; pi extensions.test.ts:145–148, 157–158, 256–257, 478) only where the new rule changes the answer.
- [ ] Both suites + tsc → PASS. Commit `feat(guard): push the own work branch without a question`.

### Task 2: Verdicts in a multi-repository folder
**Files:** `lib/reviews.ts` (shared), `lib/hooks.ts`, pi `extensions/guard.ts`, `scripts/review-log.ts` (both) · Tests `tests/reviews.test.ts`, `tests/hooks.test.ts`, pi `tests/extensions.test.ts`
- [ ] Tests for criterion 4 (folder with two child repos; record via SubagentStop with `projectDir` = folder; gate for `git -C child push …` and `cd child && gh pr create`; review-log from the folder; ambiguous SHA) → FAIL.
- [ ] Implement `repoFor` and the call-site changes. Both suites + tsc → PASS. Commit `fix(review-gate): record and read verdicts by the repository`.

### Task 3: Skills, docs, release
- [ ] Skill and doc text per criterion 5 and Post-implementation; version 0.16.0; `release.ts check`. Commit `docs: 0.16.0 own-branch push`.

## Progress

- Root cause for criterion 4 confirmed before planning: no record exists under the workspace key or the repository key in `$TMPDIR/eng-kit/reviews`; `recordVerdict` returns "is not a commit in this repository" for a non-repository `projectDir` (`lib/reviews.ts:101-102`).
