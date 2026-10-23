# Verify and review gates work in a folder of several git repositories

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 7ad427089b68bf64aecc0148d5833c3b12c32df6
Links: None

<details><summary>Original request</summary>

«что осталось из важного доделать?» → item 1 of the answer (the verify gate re-fires on a redirect to an unexpanded variable path; the review gate records no verdict) → «давай продолжим 1». Choices made in the conversation: «Поддержать workspace»; «Да, пересматриваем» (revisits the 0.16.0 rule that reverted multi-repo support); files outside the repositories: «Отпечаток файлов»; split into three tasks: «Да, начинаем с 1». Design: «да, давай».

</details>

## Intent

Someone who starts Claude Code in a folder that is not a git repository but holds several (a polyrepo workspace: services side by side, frontend next to backend) gets the same verify and review gates as inside one repository, instead of gates that silently weaken.

## Context

The kit treats the session folder as one git repository. In a non-git folder of repositories `treeFingerprint` returns nothing, so the verify gate guesses written files from command text and counts `> $S/red.log` with an unknown `S` as the project file `$S/red.log` (reproduced: `cd src && … > $S/red.log`, `S=$(mktemp -d); … > $S/x`, a loop, a variable from an earlier call); it also misses changes made by subagents and background scripts. `recordVerdict` runs `git rev-parse` in that folder and fails, so no verdict is ever recorded, and `cd <repo> && gh pr create` is denied for want of a verdict that can't exist.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | `projectRepos` reports `repo` inside git, `workspace` with the first-level git repositories (sorted, ignored folders and nested levels left out, at most 32) for a non-git folder that holds some, and `none` otherwise | unit: tests/repos.test.ts |
| 2 | In a workspace, a shell call that changes a file in any repository, commits in one, or changes a file outside the repositories is marked as an edit with its workspace-relative path; a call that changes nothing marks nothing, whatever its redirect text (`> $S/red.log` with unknown `S`) | unit: tests/worktree.test.ts; hooks: tests/hooks.test.ts (PreToolUse → PostToolUse in a temp workspace) |
| 3 | Changes made by a subagent or a background script in a workspace are found at the next fingerprint (Stop) | hooks: tests/hooks.test.ts |
| 4 | Over 5000 entries or after a git failure, only the affected part falls back: a repository to text targets inside it, files outside the repositories to text targets outside them | unit: tests/worktree.test.ts |
| 5 | Session state saved by 0.33.0 (a `Tree` without the new field) still loads and compares | hooks: tests/hooks.test.ts (state written in the 0.33.0 shape) |
| 6 | In a workspace, a reviewer's verdict is recorded in the store of every repository that has the reviewed commit; a SHA in none gives an error naming the repositories; the Inconclusive fallback lands on each repository's HEAD | unit: tests/reviews.test.ts; hooks: SubagentStop test in a temp workspace |
| 7 | `cd <repo> && gh pr create` and `git -C <repo> push` in a workspace pass with a `Yes` for that repository's HEAD and are denied without one; same-named PR branches in two repositories don't affect each other | unit: tests/reviews.test.ts |
| 8 | `scripts/review-log.ts <sha>` run from the workspace folder finds the repository that has the commit | e2e: tests/hooks.test.ts (review-log block) |
| 9 | Inside a single repository every gate behaves as in 0.33.0 | the full existing suite stays green |
| 10 | Whether SubagentStop fires when a reviewer is continued with SendMessage is checked live and recorded; a fix, if one is needed, is a follow-up | manual: one live probe in a workspace — hook delivery can't be simulated, agreed 2026-10-23 |
| 11 | Live in a workspace: a review records its verdict, and a run with a redirect to an unknown variable path doesn't re-fire the verify gate | manual: one session in a workspace after the change — needs a real Claude Code session, agreed 2026-10-23 |

## Scope

**In scope:**
- shared module `lib/repos.ts` with `projectRepos`;
- the verify gate's fingerprint, comparison and fallback in a workspace (`lib/worktree.ts`, `lib/state.ts`, `lib/hooks.ts`);
- recording verdicts, checking landings and PR branch tracking per repository (`lib/reviews.ts`, `lib/hooks.ts`), and `scripts/review-log.ts`;
- README, docs/ARCHITECTURE.md, docs/ARCHITECTURE.ru.md, skills/requesting-code-review/references/review-gate.md, CHANGELOG 0.34.0.

**Out of scope:**
- the guard in a workspace (CI and protected paths in child repositories, own-branch push, the task-file leak guard, the approval gate): follow-up 1;
- the token ledger and kit-init command detection in a workspace: follow-up 2;
- repositories deeper than the first level, git submodules as separate repositories;
- a fix for SubagentStop on a continued reviewer, if the probe shows one is needed.

## Decisions

1. Support polyrepo workspaces as a general feature (user, 2026-10-23). This revisits the 0.16.0 rule ("kits change only for what serves any user"): a non-git parent of repositories is a common layout, and without support its gates weaken silently.
2. Files outside the repositories are tracked by a size-and-mtime walk, with text targets only past the limit (user, 2026-10-23).
3. Three tasks: this one, then the guard, then the ledger and kit-init (user, 2026-10-23).
4. Only first-level repositories, at most 32, found by a `.git` entry without running git; more than 32 is treated as `none`. **assumed**, shown in the design and approved.
5. A verdict goes to every repository that has the commit: two clones of one history share the commit, so the verdict holds in both. The Inconclusive fallback goes to every repository's HEAD (fail-closed). Shown in the design and approved.
6. `lib/repos.ts`, `lib/worktree.ts` and `lib/reviews.ts` stay byte-identical with the other edition's copies.
7. Release as 0.34.0.

## Design

**`lib/repos.ts`.** `projectRepos(projectDir, ignore): { kind: "repo" | "workspace" | "none"; repos: string[] }`. `repo` when `projectDir` is inside a git working tree; otherwise `workspace` when its direct subfolders that hold a `.git` entry (folder or file), minus ignored ones, number 1..32 (`repos` are their names, sorted); otherwise `none`. No git call for discovery.

**Fingerprint.** `Tree` gains `heads?: Record<string, string>` (repository → HEAD) and `outside?: boolean` (files outside the repositories walked). `treeFingerprint` in a workspace merges each repository's `git status` entries with the repository name prefixed, records each HEAD, and adds every file outside the repositories (not ignored, not under `.git`) with its size and mtime. `changedPaths` compares entries as today and, per repository whose HEAD moved, adds the files its commits touched. A repository over 5000 entries or failing git is left out of the tree and listed as such; the shell fallback then reads text targets inside it. A walk over 5000 files or over its time budget drops `outside`, and text targets outside the repositories count again. Without `heads` a saved tree reads as a single repository's.

**Hooks.** `trackTree` takes the fingerprint and the fallback per part, as above. Write/Edit marking is unchanged.

**Reviews.** `recordVerdict` in a workspace resolves the SHA (and BASE) in each repository and writes the record into `reviewsDir(<repository>)` of each that has it; none → `Reviewed HEAD … is not a commit in any repository here (<names>)`. `subagentStop`'s fallback records Inconclusive on each repository's HEAD. `uncovered`, `notePr`, `settlePr` and `openPrBranches` read and write the store of the landing's repository (`where`) instead of the session folder's; in a single repository both resolve to the same git common dir. `review-log.ts` resolves the SHA in the current folder, else in each workspace repository.

**Errors.** Warnings name the repository. A failure in one repository never disables another.

## Rollout

Minor release 0.34.0. Old session state and review stores keep working: the stores were already keyed by git common dir. Rollback: install 0.33.0.

## Risks and open questions

- A large workspace makes each shell call slower (N × `git status` plus the walk) → the 2 s snapshot budget and the 5000-entry limits still apply; measure on a workspace with two repositories in the plan.
- An Inconclusive fallback on every HEAD can hold back a parallel reviewer's Yes in another repository → accepted as fail-closed; rare (needs a malformed report).
- Hook input or `CLAUDE_PROJECT_DIR` may differ when the agent `cd`s into a repository → the plan checks it live before relying on it.

## Follow-ups

- 1. The guard in a workspace: CI and protected paths in child repositories ask, own-branch push in a child repository, the task-file leak guard and the approval gate per repository. Builds on `projectRepos`. Next, since it closes a protection gap.
- 2. The token ledger and kit-init command detection in a workspace. Builds on `projectRepos`.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** the verify and review gates see every repository of a non-git folder of git repositories, as they see one repository.
**Architecture:** a new shared `lib/repos.ts` names the project's repositories; `lib/worktree.ts` fingerprints each of them plus a walk of the files outside them, and a shared `callChanges` decides what a call changed; `lib/reviews.ts` records a verdict in every repository that has the commit and checks a landing against its own repository's store. `lib/hooks.ts` only switches to `callChanges`.
**Stack / constraints:** Node ≥22.18 running `.ts` natively, `node:test`, no new dependencies. `lib/repos.ts`, `lib/worktree.ts`, `lib/reviews.ts` stay byte-identical with the other edition's copies (`cmp` must pass); imports stay relative (`./commands.ts`). Everything written in English. Commits: Conventional Commits, repo-local identity, no trailers. Values: at most 32 repositories (`MAX_REPOS`), 5000 entries per part (`MAX_ENTRIES`), workspace fingerprint budget 2000 ms (`WORKSPACE_BUDGET_MS`), git timeout per call `min(3000, time left)`.
**Verification:** in `src_claude/`: `npm run typecheck`, `npm test`; from the workspace root, the bare `node "<kit>/scripts/verify.ts"` (workspace `.claude/verify.json`).

Ruling: the two defects' red reproductions open Task 3 (verify) and Task 4 (review): they need `projectRepos` (Task 1) to set up a workspace at all, and every commit stays green.

Checked 2026-10-23: `CLAUDE_PROJECT_DIR` is empty in the Bash tool's environment, so `scripts/verify.ts` uses the shell's cwd; the hooks get it set. No design change: the gates run in hooks.

### Review focus
1. A repository whose `git status` times out or exceeds 5000 entries: only it becomes blind, and text targets inside it still count (Task 2, Task 3).
2. Two repositories that are clones of one history: a verdict lands in both, and a branch named the same in both doesn't share PR state (Task 4).
3. Session state written by 0.33.0 without `heads`/`blind` loads and compares as a single repository's (Task 3).
4. A repository folder removed between two fingerprints: its listed files count as changed, nothing throws (Task 2).
5. A `.git` *file* (a worktree checkout) at the first level counts as a repository; a symlinked folder is neither a repository nor walked (Task 1, Task 2).

### Post-implementation
- README.md "Verify gate" and "Review gate": a paragraph on folders of repositories (what is fingerprinted, where verdicts go, the 32 / 5000 / 2 s limits).
- docs/ARCHITECTURE.md and docs/ARCHITECTURE.ru.md: the PostToolUse and SubagentStop rows, the reviews path note, "How it's verified".
- skills/requesting-code-review/references/review-gate.md: records per repository, found from a folder of repositories too.
- CHANGELOG.md `## 0.34.0`; version 0.34.0 in package.json and .claude-plugin/plugin.json (`node .github/release.ts check` passes).
- The topic chapter is README "Verify gate" / "Review gate" (this repo has no `docs/NN-*` chapters). No decision record: the decisions go to CHANGELOG and ARCHITECTURE.

### Files
- Create `lib/repos.ts`: which repositories the project is (`projectRepos`, `repoOf`).
- Modify `lib/worktree.ts`: workspace fingerprint, `changedPaths` per repository, `callChanges`.
- Modify `lib/state.ts`: `isTree` accepts the new optional fields.
- Modify `lib/hooks.ts`: `trackTree` uses `callChanges`.
- Modify `lib/reviews.ts`: `commitRepos`, workspace `recordVerdict`, landing store through `repoOf`, PR tracking per repository.
- Modify `scripts/review-log.ts`: finds the commit's repository.
- Tests: create `tests/repos.test.ts`; modify `tests/worktree.test.ts`, `tests/hooks.test.ts`, `tests/reviews.test.ts`.

### Task 1: repositories of a project

**Files:** Create `lib/repos.ts` · Test `tests/repos.test.ts`
**Interfaces:** Produces `projectRepos(projectDir: string, ignore?: string[]): { kind: "repo" | "workspace" | "none"; repos: string[] }`, `repoOf(projectDir: string, path: string): string`, `MAX_REPOS = 32`

- [x] Write failing tests against a stub that returns `{ kind: "none", repos: [] }` and `projectDir`:
  - `a folder inside git is one repository` → `{ kind: "repo", repos: [""] }`, also from a subfolder;
  - `a non-git folder of repositories is a workspace` → temp dir with `b/.git` (folder), `a/.git` (file `gitdir: …`), `plain/`, `ignored/.git` with ignore `["ignored/**"]`, `deep/x/.git`, a symlink `link → b` → `{ kind: "workspace", repos: ["a", "b"] }`;
  - `no repositories, or more than 32, is none` → an empty dir and a dir of 33 repositories give `{ kind: "none", repos: [] }`;
  - `repoOf names the repository a path is in` → `repoOf(ws, ws/b/src/x)` = `ws/b`; `repoOf(ws, ws/plain/x)` and `repoOf(ws, /elsewhere)` = `ws`; inside a repo it returns `projectDir`.
- [x] Run `node --test tests/repos.test.ts` → expect FAIL on the `kind` and `repos` assertions
- [x] Implement: `repo` when `git rev-parse --is-inside-work-tree` succeeds (one call, 3 s timeout); else the direct subfolders (`readdirSync` with file types, symlinks excluded) holding a `.git` entry, minus those a glob ignores (`isIgnored(name, ignore)`, or a `<stem>/**` glob whose stem is `name`), sorted; 1..32 of them → `workspace`. `repoOf` returns `join(projectDir, r)` for the workspace repository containing `path`, else `projectDir`.
- [x] Run `node --test tests/repos.test.ts` → PASS, then `npm test`
- [x] Commit `feat(repos): name the repositories of a project folder`

### Task 2: workspace fingerprint

**Files:** Modify `lib/worktree.ts` · Test `tests/worktree.test.ts`
**Interfaces:** Consumes `projectRepos` · `Tree` gains `heads?: Record<string, string>` (repository → HEAD, `""` before its first commit) and `blind?: string[]` (parts not fingerprinted: a repository, or `""` for the files outside the repositories) · `treeFingerprint(projectDir, ignore, why = {}, limits: { deadline?: number; maxEntries?: number } = {})`; `changedPaths` keeps its signature

- [x] Write failing tests in a temp workspace with repositories `a`, `b` (one commit each) and a loose file `notes/x.js`:
  - `a workspace fingerprint lists each repository's changes under its folder` → edit `a/f.ts`, add `b/n.ts` → `changedPaths` = `["a/f.ts", "b/n.ts"]`;
  - `a commit in one repository counts its files` → commit `b/c.ts` between fingerprints → `["b/c.ts"]`, `heads.b` differs;
  - `a file outside the repositories counts, an ignored one doesn't` → edit `notes/x.js` and `docs/y.md` → `["notes/x.js"]`;
  - `a repository over the limit is blind, not the workspace` → `limits.maxEntries = 2` with three new files in `a` → `blind` = `["a"]`, a change in `b` still listed;
  - `an expired deadline leaves every part blind` → `limits.deadline = Date.now() - 1` → `blind` = `["", "a", "b"]`, `files` = `{}`;
  - `a removed repository folder counts its listed files` → remove `a/` after a fingerprint with `a/f.ts` dirty → `a/f.ts` listed, no throw.
- [x] Run `node --test tests/worktree.test.ts` → expect FAIL: `treeFingerprint` returns `undefined` for the workspace
- [x] Implement `workspaceFingerprint` behind `treeFingerprint` (kind `repo` → today's code, unchanged; `none` → `undefined`): per repository today's status logic with paths prefixed `<repo>/` and its HEAD into `heads`; then a walk of the project skipping repository folders, `.git`, symlinks and ignored paths (a directory is pruned when a `<stem>/**` glob's stem matches it), each file by `identity()`. A part over `maxEntries` (default `MAX_ENTRIES`), failing git, or reached after the deadline (default now + `WORKSPACE_BUDGET_MS`) goes into `blind` and contributes no entries; each git call's timeout is `min(GIT_TIMEOUT_MS, time left)`. `changedPaths`: when both trees have `heads`, the HEAD diff runs per repository whose HEAD moved, in `join(projectDir, repo)`, results prefixed; without `heads`, as today.
- [x] Measure `treeFingerprint` on the real workspace root, 5 runs; record the median in Progress (risk "a large workspace").
- [x] Run `node --test tests/worktree.test.ts` → PASS, then `npm test`
- [x] Commit `feat(verify): fingerprint every repository of a workspace and the files outside them`

### Task 3: the verify gate counts what a workspace call changed

**Files:** Modify `lib/worktree.ts`, `lib/state.ts`, `lib/hooks.ts` · Test `tests/worktree.test.ts`, `tests/hooks.test.ts`
**Interfaces:** Produces `callChanges(before: Tree | undefined, now: Tree | undefined, projectDir: string, after?: { command: string; cwd: string; powershell?: boolean }): string[]` (ignore filtering stays with the caller)

- [ ] Red reproduction in `tests/hooks.test.ts` with a helper `setupWorkspace()` (temp dir, repositories `a` and `b` with one commit each, `.claude/verify.json` with one command): `in a workspace, a redirect to an unknown variable path marks nothing` → `bash("cd a && true > $S/red.log")` writing no project file → `loadState(...).unverified` is false. Run `node --test tests/hooks.test.ts` → expect FAIL: edited `["$S/red.log"]`.
- [ ] Write failing tests:
  - hooks `in a workspace, a shell write in a repository marks it` → `bash("echo x > a/f.ts")` → edited `["a/f.ts"]`;
  - hooks `a write between calls in a workspace is found at Stop` → write `b/n.ts` from the test, then `stop` → block reason lists `b/n.ts`;
  - hooks `state saved without heads still compares` → state with a 0.33.0-shape `tree` (`{ head, files }`) in a single repository, then a write → marked as before;
  - unit `callChanges reads text targets only inside blind parts` → blind `["a"]`: `> a/x` counts, `> b/x` doesn't; blind `[""]`: `> loose.js` counts, `> a/x` doesn't.
- [ ] Run `node --test tests/hooks.test.ts tests/worktree.test.ts` → expect FAIL on those assertions
- [ ] Implement `callChanges`: both trees → `changedPaths(before, now, projectDir)` plus `shellWriteTargets` filtered to paths inside a part blind in either tree (`""` = under no repository named in `heads` or `blind`); a tree missing and `after` given → text targets, as today. `isTree` accepts optional `heads` (string record) and `blind` (string array). `trackTree` computes `paths` as `callChanges(...).filter((p) => !isIgnored(p, ignore))`; `gitOff` is set only by a `repo` fingerprint (a workspace never sets `why.slow`).
- [ ] Run `node --test tests/hooks.test.ts tests/worktree.test.ts` → PASS, then `npm test` and `npm run typecheck`
- [ ] Commit `fix(verify): a workspace call counts what it changed, not what its text names`

### Task 4: verdicts per repository

**Files:** Modify `lib/reviews.ts` · Test `tests/reviews.test.ts`
**Interfaces:** Consumes `projectRepos`, `repoOf` · Produces `commitRepos(projectDir: string, rev: string): Array<{ dir: string; sha: string }>`; `recordVerdict` and `recordReview` keep their signatures and return the first record

- [ ] Red reproduction: `a workspace records the verdict in the repository that has the commit` → workspace of `repo()`-style repositories `a`, `b`; `recordReview(ws, <report naming a's HEAD>)` returns a record and `readReviews(ws/a)` holds it. Run `node --test tests/reviews.test.ts` → expect FAIL: `"Reviewed HEAD … is not a commit in this repository"`.
- [ ] Write failing tests:
  - `clones of one history both record the verdict` → `b` cloned from `a` → both stores hold it;
  - `a SHA in no repository names them` → `"Reviewed HEAD <sha> is not a commit in any repository here (a, b)"`;
  - `HEAD records on each repository's HEAD` → `recordVerdict(ws, "HEAD", "Inconclusive")` → one record per store, each on its own HEAD;
  - `a workspace PR from a repository passes with its Yes and is denied without` → `check("cd a && gh pr create", { missing: "block" }, ws)`;
  - `a push to a repository's PR branch is gated by that repository's store` → `notePr`/`settlePr` for `cd a && gh pr create`, then `git -C a push origin feat/a` is gated;
  - `a branch named the same in another repository is not a PR branch` → push of `feat/a` from `b` is not gated by `a`'s PR.
- [ ] Run `node --test tests/reviews.test.ts` → expect FAIL on those assertions
- [ ] Implement: `commitRepos` → `[{ dir: projectDir, sha }]` for kind `repo`, each workspace repository where `rev^{commit}` resolves, `[]` otherwise. `recordVerdict` writes one record per entry into `reviewsDir(entry.dir)`, BASE resolved in the same repository (entries without it skipped; none left → the BASE error); the not-a-commit error names the repositories in a workspace. `uncovered` and `openPrBranches` use the store of `repoOf(projectDir, where)`. `notePr` stores `{ prs: Array<{ branch, dir }>, at, last }`; `settlePr` writes each branch into the `prs.json` of `repoOf(projectDir, dir)` and still reads the legacy `branches`/`branch` entries (dir = `projectDir`).
- [ ] Run `node --test tests/reviews.test.ts` → PASS, then `npm test`
- [ ] Commit `fix(review-gate): record and check verdicts per repository of a workspace`

### Task 5: SubagentStop and review-log in a workspace

**Files:** Modify `scripts/review-log.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Consumes `commitRepos`

- [ ] Write failing test `review-log finds the commit from the workspace folder` → spawn the script with `cwd: ws`, `ENG_KIT_REVIEWS_ROOT`, rev = `a`'s HEAD with a recorded review → exit 0 and the report printed. Run → expect FAIL: exit 1, `is not a commit in this repository`.
- [ ] Add hooks tests `SubagentStop records a workspace reviewer's verdict` (→ `readReviews(ws/a)` has `Yes`, no warning) and `a malformed report in a workspace lands Inconclusive on each HEAD`. They pass on Task 4's code: confirm each fails when `commitRepos` returns `[]` (a temporary mutation of a copy, not the file), then keep them as regression tests.
- [ ] Implement: review-log resolves `rev` in `process.cwd()`; failing that, takes the first `commitRepos(process.cwd(), rev)` entry and reads its reports, chain and IDs from that folder; error `<rev> is not a commit in this repository or any repository here`.
- [ ] Run `node --test tests/hooks.test.ts` → PASS, then `npm test`
- [ ] Commit `fix(review-log): find the commit's repository from a workspace folder`

### Task 6: docs and release 0.34.0

**Files:** Modify README.md, docs/ARCHITECTURE.md, docs/ARCHITECTURE.ru.md, skills/requesting-code-review/references/review-gate.md, CHANGELOG.md, package.json, .claude-plugin/plugin.json

- [ ] Update each doc as Post-implementation lists; ARCHITECTURE.ru.md stays Russian (an existing Russian file keeps its language)
- [ ] Run `npm test` (lint-skills, release) and `node .github/release.ts check` → PASS
- [ ] Commit `docs: workspace gates (0.34.0)`

### Task 7: live checks

- [ ] Criterion 10: in a workspace session, dispatch `eng-kit:reviewer` on a small range, continue it with SendMessage, and check with review-log from the workspace whether the second verdict was recorded. Record the result in Progress; a needed fix goes to Follow-ups.
- [ ] Criterion 11: with this branch loaded (`claude --plugin-dir src_claude` from the workspace root), run one review and one `cd src && … > $S/red.log` call → the verdict is recorded and the verify gate doesn't re-fire. Record in Progress.
- [ ] Bare `node "<kit>/scripts/verify.ts"` from the workspace root → all four commands pass.

## Progress

- Baseline 2026-10-23 on 389a370: workspace verify 4/4 PASS (typecheck and test in both editions).
- Drift check: none (the plan was written on this HEAD).
- Pre-flight: Interfaces agree across tasks; no conflicts.
- Task 1: complete (389a370..feat(repos) commit, node --test tests/repos.test.ts → 4 pass after RED on the kind/repos/repoOf assertions; npm test → 532 tests: 521 pass, 11 skipped (publish build tests, mode: needs pandoc, typst and mmdc), 0 fail; tsc clean).
- Measured 2026-10-23: treeFingerprint on the real two-repository workspace root, 5 runs: 61/66/71/82/95 ms, median 71 ms (7 files outside the repositories, nothing blind).
- Task 2: complete (b965899..feat(verify) fingerprint commit, node --test tests/worktree.test.ts → 6 new tests RED on 'a git repository has a fingerprint' / falsy tree, then 20 pass; npm test → 538 tests: 527 pass, 11 skipped, 0 fail; tsc clean).
