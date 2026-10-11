# The verify gate sees shell edits and keeps the final report whole

Status: in progress — review round 1 rework awaiting approval
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: d52179d66a0b8d59f34dbd03ef44ccf5a5f5715f (eng-kit) · 0cc4f39a58a5661bf92a6f9446c08fa355218b2a (pi)
Links: docs/EVALS.md ("Do the skills load?", the rollout-reported finding); the pi edition's branch of the same name

<details><summary>Original request</summary>

"запускаем" (brainstorming after the spike on the lost final report). Choices made in this session: detect shell edits from the git state, with a text fallback outside git; in a project with no verification commands, detect them as kit-init does and, if none are found, notify the user instead of sending the agent back; when the gate sends the agent back, it asks for the complete final report again.

</details>

## Intent

The verify gate in both editions notices every change to the project's code, including edits made from the shell, finds the project's checks without configuration where it can, and never makes the agent's last message a verification-only note, so "done" without a check can't slip through and a `claude -p` or CI user gets the whole report.

## Context

The tracker marks the workspace unverified only on Edit/Write/MultiEdit/NotebookEdit (`lib/hooks.ts:224`, pi `extensions/verify.ts` `tool_result`), so files written with `cat >`, a heredoc, `sed -i` or a script are invisible to it; in 3 of 3 recent `db-required-column` runs the agent wrote that way. In a project without `.claude/verify.json` or a Commands section nothing can clear the mark (`lib/hooks.ts:253`), so after any Edit/Write the Stop hook always sends the agent back with "state exactly how the change was verified", and the agent's answer, a verification-only note, replaces its report as the last message (0 of 3 runs kept the rollout steps).

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | In a git project, a Bash command that changes a tracked or new, non-ignored file inside the project (heredoc, `sed -i`, a script) makes the workspace unverified and lists the changed paths in the Stop reason | unit: hooks test with a temp git repo, both editions |
| 2 | Changes to gitignored files, to paths matching verify.json `ignore`, and to files outside the project don't mark it | unit: `treeFingerprint` tests |
| 3 | Outside git, a command whose `>`, `>>`, `tee` or `sed -i` target is inside the project marks it; `> /tmp/x`, `2>/dev/null` and reads don't | unit: `shellWriteTargets` tests |
| 4 | A run of the verification commands that itself changes files (e.g. `lint --fix`) doesn't mark the workspace again | unit: hooks test |
| 5 | Without verify.json and a Commands section, the commands come from the project's manifests (the same detection kit-init uses: package.json scripts, turbo, gradle, cargo, go, dotnet, pytest, make); verify.json and the Commands section still win | unit: `resolveVerifyCommands` tests |
| 6 | With no commands configured or detected, Stop doesn't send the agent back; the user sees one notice per session naming kit-init and verify.json | unit: hooks test (Claude: `systemMessage`; pi: `ui.notify`) |
| 7 | When the gate sends the agent back, its text asks for the complete final report (what changed, what the user must do next, the checks and their results), not a verification-only note | unit: reason text assertion, both editions |
| 8 | Everything 0.24.0's verify gate blocked is still blocked, except criterion 6's case | unit: the existing verify-gate tests pass unchanged; the one no-commands test is changed in its own commit |
| 10 | A `git add`, `git commit` or `git stash` after a green run doesn't mark the workspace; an edit and a commit in one command does | unit: worktree + hooks + pi tests |
| 11 | A command that chains a verification run with a write (`npm test && sed -i …`, `npm test; cat > …`), or a failed verification run, doesn't hide the write | unit: hooks + pi tests |
| 12 | A broken verify.json still sends the agent back, naming the parse error; the review gate ignores detected commands | unit: hooks + pi tests |
| 9 | On `db-required-column`, `rollout-reported` with the kit is at least as good as without it; no other graded behavior of `db-required-column` or `tdd-discount` drops | eval: with/without, 3 runs per arm, results in docs/EVALS.md |

## Scope

**In scope:**
- the verify tracker and Stop/agent_end gate of both editions; a shared `lib/worktree.ts`; verify command detection moved into `lib/commands.ts` and used by kit-init from there;
- tests, docs (README verify gate, using-skills' verification line, ARCHITECTURE in both editions, EVALS.md, CHANGELOG, the private FRAMEWORK-SOURCES §11.32), version 0.25.0 in both editions.

**Out of scope:**
- the review gate, the guard's own write detection and its `/dev/null` false positive;
- the eval graders that still use trace judges; `sed -i` forms with `|` or `;`;
- changing the verification-before-completion skill's report format.

## Decisions

1. Shell edits are found by comparing a fingerprint of the git working tree (`git status --porcelain=v1 -z --untracked-files=all -- .` plus size and mtime of each listed file) before and after; outside git, or when git fails or takes over about 3 s, by the text of the command. Chosen by the user over text-only parsing, which a script in any other language escapes.
2. ~~Rolling fingerprint~~ — replaced in review round 1 (user, 2026-10-11): changes are attributed per tool call. A snapshot is taken before each shell call (Claude PreToolUse, pi `tool_call`, keyed by the call id) and compared with the call's result; a change between the last result and the next snapshot (the user's editor, a background process) also counts — always in Claude, and in pi only in a process with a UI (one without is usually a subagent's own process, whose siblings' writes aren't its own). Claude's Stop compares once more against the last snapshot.
3. A project without configured commands gets detected ones; if none are found, the gate only notifies, once per session. Chosen by the user; it relaxes the 0.24.0 behaviour for that case only.
4. The send-back text asks for the complete final report again: costs one more report's tokens, keeps `-p`/CI output whole. Chosen by the user.
5. Shared library files stay byte-identical between the editions (`lib/worktree.ts`, `lib/shell.ts`); `lib/commands.ts` keeps its per-edition file names.
7. Detected commands drive the verify gate, the verify script and `run_verification` only; the review gate's "unverified edits" rule, the reviewer's shell allowlist and the read-only steps allowed before a landing keep using configured commands only, as in 0.24.0 (user, 2026-10-11): a project nobody configured doesn't get its PRs refused over a detected `npm run build` that needs secrets.
8. A fingerprint over 5,000 entries, or a git call that times out, switches the session to the command-text fallback for good (user, 2026-10-11). Measured: 18–19 ms median (36 ms max) on the kit repositories (~300 files), 89 ms median (207 ms max) on a 7,646-file repository.
9. The fingerprint holds content identity only (`"<size> <mtimeMs>"` or `"deleted"`) plus `HEAD`: staging and committing aren't changes; a path that left `git status` counts only if its size or time differ from the last entry; when `HEAD` moves, files the commits touched that were clean before count (an edit and a commit in one command).
10. A command is a verification run only when it succeeded and every segment, after heredoc bodies are removed, is a configured or detected verification command or the verify-script call (optionally piped to `tail`, `head` or `grep`); otherwise its changes mark first and the commands it ran are credited after. pi's `run_verification` compares before it runs, so earlier changes mark, and only its own writes are exempt.
11. A `verify.json` that fails to parse keeps 0.24.0's send-back and names the error.
6. A Stop hook's JSON output with `systemMessage` and no `decision` shows the text to the user without blocking: verified live on Claude Code 2.1.296 (stream-json event `system/informational`, "Stop says: …"; one assistant turn).

## Design

**`lib/worktree.ts` (new, shared):**
- `treeFingerprint(projectDir: string, ignore: string[]): Record<string, string> | undefined` — runs git with a timeout, drops paths matching `ignore`, and maps each listed path (relative to the project) to `"<status> <size> <mtimeMs>"` (`"deleted"` for a missing file); `undefined` outside git, on error or timeout.
- `changedPaths(before: Record<string, string>, after: Record<string, string>): string[]` — the paths whose entry was added, removed or differs; empty means no change. The hook lists them in the Stop reason.
- `shellWriteTargets(command: string, cwd: string, projectDir: string): string[]` — inside-project targets of `>`, `>>`, `>|`, `&>`, `tee [-a]` and `sed -i`, using `lib/shell.ts`.

**`lib/commands.ts`:** `resolveVerifyCommands(cwd)` returns `source: "detected"` with the manifest detection when the first two sources give nothing; `detectVerifyCommands` in `lib/init.ts` delegates to it.

**Claude `lib/hooks.ts` and `lib/state.ts`:** the session state keeps the last fingerprint; PostToolUse and PostToolUseFailure for shell tools compare and mark; edit tools refresh it; Stop compares once more, then either blocks with the new text or, with no commands, returns a one-time `systemMessage`.

**pi `extensions/verify.ts`:** the same on `session_start`, `tool_result` (bash/powershell) and `agent_end`; the notice goes through `ctx.ui.notify` when there is a UI.

## Rollout

None: a plugin release (0.25.0 in both editions). Users update with `/plugin` (Claude) or pi's package update. Rollback is the previous release.

## Risks and open questions

- `git status` on a very large repository adds latency to every shell command → the timeout falls back to the text heuristic for that command; measured on this repository during implementation.
- A user's own edits between prompts mark the workspace unverified → intended: the tree holds unchecked code.
- Detected commands may be slow (`npm run build`) or fail without dependencies installed → same as kit-init today; the gate reports the failure honestly.

## Follow-ups

- The guard's `rm -r … 2>/dev/null` false positive (`lib/patterns.ts:161`).
- Eval graders still judged on the trace in legacy-change and db-required-column; `sed -i` with `|` or `;` in the order graders.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** the verify gate of both editions marks shell edits, finds the project's checks without configuration, notifies instead of sending the agent back when there are none, and asks for the complete final report when it does send it back.
**Architecture:** a shared `lib/worktree.ts` fingerprints the git working tree (text fallback outside git); `lib/commands.ts` gains a `detected` source; the Claude hooks and the pi verify extension compare fingerprints after shell commands and at stop.
**Stack / constraints:** Node ≥ 22.18 running `.ts` directly (erasable syntax only); no new dependencies; `lib/worktree.ts` and `lib/shell.ts` byte-identical in `src_claude/lib/` and `src/extensions/lib/`; git invoked as `git --no-optional-locks status --porcelain=v1 -z --untracked-files=all -- .` with `cwd: projectDir`, `timeout: 3000`, `maxBuffer: 16 MiB`; skill bodies ≤ 800 words; commits use the repo identity, no trailers.
**Verification:** `node "<kit>/scripts/verify.ts"` from the workspace (runs `npm run typecheck` and `npm test` in `src` and `src_claude`).

### Review focus
1. A shell command run from another folder (`cwd` ≠ project) still has its project changes found: the fingerprint is always of `projectDir` (Task 4; pi's bash has no separate cwd).
2. A file deleted or renamed from the shell marks the workspace (entry `deleted`, new path added) (Task 1).
3. A command that fails after writing (PostToolUseFailure / `isError`) still marks (Task 4, Task 5).
4. `projectDir` inside a larger repository: changes outside it don't count (`-- .` pathspec) (Task 1).
5. A session whose state has no fingerprint yet (started before the upgrade) takes one at the next shell command or stop without marking (Task 4).

### Post-implementation
- `src_claude/README.md` "verify gate": what counts as unverified (shell changes found from git, text fallback), detected commands, the no-commands notice, the full-report send-back. `src/README.md`: the matching pi section.
- `src_claude/skills/using-skills/SKILL.md:54`: "A Stop hook returns you once if files changed since the last green run" → "…if files changed (also from the shell) since…"; word budget re-checked. pi's `using-skills` doesn't describe the gate (`:56` names only `run_verification`): none.
- `docs/ARCHITECTURE.md` and `.ru.md` in both editions: the verify tracker rows.
- `docs/EVALS.md`: the measurement from Task 6. `CHANGELOG.md` 0.25.0 in both editions; versions in `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`.
- Private `docs/FRAMEWORK-SOURCES.ru.md` §11.32. No `docs/decisions/` in these repos: the lasting rule lives in README and ARCHITECTURE.

### Files
- `src_claude/lib/worktree.ts` (new; copied byte-identical to `src/extensions/lib/worktree.ts`): tree fingerprint, changed paths, shell write targets.
- `src_claude/lib/commands.ts`, `src/extensions/lib/commands.ts`: `manifestCommands`, the `detected` source.
- `src_claude/lib/init.ts`, `src/extensions/lib/init.ts`: `detectVerifyCommands` delegates; the moved body and `safeList` go.
- `src_claude/lib/state.ts`: `tree` and `notified` fields.
- `src_claude/lib/hooks.ts`: SessionStart baseline, shell comparison, Stop comparison, reason text, notice.
- `src/extensions/verify.ts`: the same for pi.
- Tests: `tests/worktree.test.ts` (new, both editions, same content), `tests/commands.test.ts` (both), `src_claude/tests/hooks.test.ts`, `src/tests/extensions.test.ts`.

### Task 1: tree fingerprint

**Files:** Create `src_claude/lib/worktree.ts` · Test `src_claude/tests/worktree.test.ts`
**Interfaces:** Produces `treeFingerprint(projectDir: string, ignore: string[]): Record<string, string> | undefined` and `changedPaths(before: Record<string, string>, after: Record<string, string>): string[]`

- [x] Write failing tests in a temp git repo (`git init`, one committed `src/a.ts`, `.gitignore` with `dist/`), with stubs that return `{}` and `[]`:
  - `a write through fs changes the fingerprint`: writing `src/a.ts` → `changedPaths(before, after)` equals `["src/a.ts"]`; a new `src/b.ts` → `["src/b.ts"]`;
  - `deletes and renames show`: `rm src/a.ts` → `["src/a.ts"]` with entry `"deleted"`; `git mv src/a.ts src/c.ts` → both paths;
  - `ignored, excluded and outside paths don't`: writes to `dist/x.js`, `docs/n.md` (with `ignore` `["docs/**"]`) and, with `projectDir` = `<repo>/pkg`, to `<repo>/other.ts` → `[]`;
  - `outside git it is undefined`: a temp folder without `.git` → `undefined`.
- [x] Run `node --test tests/worktree.test.ts` → expect FAIL: expected `["src/a.ts"]`, received `[]`
- [x] Implement in `lib/worktree.ts`: parse the `-z` output (status `XY` + path; for a rename the record is followed by the old path, both count), drop `isIgnored(path, ignore)` paths, map each to `` `${XY} ${size} ${mtimeMs}` `` or `"deleted"`; any thrown error or timeout → `undefined`. `changedPaths` is the sorted union of keys whose values differ.
- [x] Run `node --test tests/worktree.test.ts` → expect PASS, then `npm test`
- [x] Commit `feat(verify): fingerprint the git working tree`

### Task 2: shell write targets outside git

**Files:** Modify `src_claude/lib/worktree.ts` · Test `src_claude/tests/worktree.test.ts`
**Interfaces:** Produces `shellWriteTargets(command: string, cwd: string, projectDir: string): string[]` (project-relative paths)

- [x] Write failing test `shell write targets inside the project` with a stub returning `[]`: `cat > src/a.ts <<'EOF'` → `["src/a.ts"]`; `echo x >> src/b.ts`, `tee src/c.ts`, `tee -a src/c.ts`, `sed -i '' 's/a/b/' src/d.ts`, `sed -i.bak 's/a/b/' src/d.ts` → that file; `cat x > /tmp/y`, `npm test 2>/dev/null`, `cat src/a.ts`, `echo > ../outside.ts` → `[]`; with `cwd` = `<project>/src`, `> a.ts` → `["src/a.ts"]`.
- [x] Run `node --test tests/worktree.test.ts` → expect FAIL: expected `["src/a.ts"]`, received `[]`
- [x] Implement: redirect targets from the same operator set as `writes()` in `lib/shell.ts` (`>`, `>>`, `>|`, `&>`, `&>>`), excluding `/dev/null` and fd duplications; `tee` operands after its options; for `sed` with an `-i` option, the last operand. Resolve against `cwd`, keep those inside `projectDir`.
- [x] Run `node --test tests/worktree.test.ts` → expect PASS, then `npm test`
- [x] Copy `lib/worktree.ts` to `src/extensions/lib/worktree.ts` and `tests/worktree.test.ts` to `src/tests/worktree.test.ts` (import path `../extensions/lib/worktree.ts`); run `npm test` in `src` → PASS
- [x] Commit in both repos `feat(verify): find shell write targets without git`

### Task 3: detected verification commands

**Files:** Modify `lib/commands.ts`, `lib/init.ts` in both editions · Test `tests/commands.test.ts` in both
**Interfaces:** Produces `manifestCommands(cwd: string): string[]`; `ResolvedCommands.source` gains `"detected"`

- [x] Write failing tests: `commands come from the manifests when nothing is configured`: a folder with `package.json` scripts `{ "test": "node --test", "lint": "eslint ." }` and `package-lock.json` → `resolveVerifyCommands` returns `{ commands: ["npm run lint", "npm test"], source: "detected" }`; `configured commands win`: the same folder plus `.claude/verify.json` (pi: `.pi/verify.json`) `{"commands":["make check"]}` → `["make check"]`, and plus a Commands section → those; `an empty folder has none`: `{ commands: [], source: "none" }`.
- [x] Run `node --test tests/commands.test.ts` → expect FAIL: expected source `"detected"`, received `"none"`
- [x] Move the manifest part of `detectVerifyCommands` (package manager, turbo, package.json scripts, gradlew, Cargo, go, dotnet, pytest, Makefile) and `safeList` from `lib/init.ts` to `lib/commands.ts` as `manifestCommands`; `resolveVerifyCommands` returns it as `"detected"` after the docs sources; `detectVerifyCommands` keeps its behaviour (docs, else `manifestCommands`). Same in pi.
- [x] Run `npm test` in both editions → PASS (the existing kit-init detection tests unchanged)
- [x] Commit in both repos `feat(verify): detect verification commands from the project's manifests`

### Task 4: Claude hooks

**Files:** Modify `src_claude/lib/state.ts`, `src_claude/lib/hooks.ts` · Test `src_claude/tests/hooks.test.ts`
**Interfaces:** Consumes Tasks 1–3. `SessionState` gains `tree?: Record<string, string>` and `notified: boolean`.

- [x] First commit, test only: change `verify gate without configured commands asks how it was verified` to `verify gate without commands notifies once and doesn't block`: `setup({})`, a Write, then Stop → no `decision`, `output.systemMessage` matches `/no verification commands/i` and names `kit-init` and `.claude/verify.json`; a second Write + Stop in the same session → `{}`. Run → expect FAIL (`decision` is `"block"`). Commit `test(verify): a project without commands gets a notice, not a send-back` (test-standard "Changing tests": the behaviour change the user approved).
- [x] Write failing tests (setup in a temp git repo with CLAUDE.md commands, committed):
  - `a heredoc write marks the workspace`: SessionStart, write `src/a.ts` through fs, PostToolUse Bash `cat > src/a.ts <<'EOF'…` → Stop blocks and the reason contains `src/a.ts`; the same through PostToolUseFailure;
  - `a shell command from another folder is still seen`: `cwd` = a temp folder outside the project, same result;
  - `a verification run that writes doesn't re-mark`: a write + Bash marks; then PostToolUse Bash `npm test` that also changes `src/a.ts` and `npm run typecheck` → Stop returns `{}`;
  - `no fingerprint yet means a baseline, not an edit`: state without `tree`, a write + Bash → Stop `{}`;
  - `outside git the command text decides`: non-git project, Bash `echo x > src/a.ts` → Stop blocks; `echo x > /tmp/y` → `{}`;
  - `the send-back asks for the complete final report`: the reason matches `/complete final report/` and names "what changed", "what the user must do next" and the checks.
- [x] Run `node --test tests/hooks.test.ts` → expect FAIL on the first assertion of each new test
- [x] Implement: `sessionStart` saves `tree = treeFingerprint(projectDir, resolveIgnore(projectDir))` (skipping when undefined); `postToolUse` for shell tools, before the existing verify logic and also for failed and background calls: compare with `state.tree` → changed paths, or `shellWriteTargets` filtered by `isIgnored` when the fingerprint is undefined; if the command is a verification run (`runsVerifyScript` or `commandMatches` any command), only store the new tree; otherwise mark like an edit (`unverified`, `green: []`, `edited` += paths, `editedAt`) and store it; edit tools also store the new tree; `stopGates` compares once more the same way before deciding; with no commands it returns `{ output: { systemMessage } }` once per session (`notified`) instead of a reason; the reason text ends with: "Your next message is the last one the user reads: make it the complete final report (what changed, what the user must do next, the checks you ran and their results), not only the verification."
- [x] Run `node --test tests/hooks.test.ts` → expect PASS, then `npm test` and `npm run typecheck`
- [x] Commit `feat(verify): the Claude gate sees shell edits, notifies without commands, asks for the whole report`

### Task 5: pi verify extension

**Files:** Modify `src/extensions/verify.ts` · Test `src/tests/extensions.test.ts`
**Interfaces:** Consumes Tasks 1–3 (pi copies)

- [x] Write failing tests with `fakePi` in a temp git repo: `a bash write marks the workspace` (`session_start`, fs write, `tool_result` bash `cat > src/a.ts …` with `isError` false and true → `agent_end` sends the follow-up naming `src/a.ts`); `a verification run that writes doesn't re-mark`; `outside git the command text decides`; `without commands: one notice, no follow-up` (`ui.notify` once per session with `/no verification commands/i`, `.pi/verify.json`, `kit-init`; no message sent); `the follow-up asks for the complete final report`. Change the existing pi test that expects a follow-up without commands, in its own commit first, as in Task 4.
- [x] Run `node --test tests/extensions.test.ts` → expect FAIL on the new assertions
- [x] Implement the Task 4 logic in `verify.ts`: `tree` kept next to `unverified`, set on `session_start`, compared in `tool_result` for bash/powershell and in `agent_end`; notice through `ctx.ui.notify(…, "warning")` when `ctx.hasUI`, once per session; the same closing sentence in the follow-up.
- [x] Run `npm test` and `npm run typecheck` in `src` → PASS
- [x] Commit `feat(verify): the pi gate sees shell edits, notifies without commands, asks for the whole report`

### Task 6: docs, version and the measurement

**Files:** the Post-implementation list
- [x] Update the docs listed in Post-implementation; bump both editions to 0.25.0; run the kit verify script → all PASS
- [x] Measure: `claude plugin eval . --case 'db-required-column' --runs 3` and the same for `tdd-discount` (with and without the kit, `--keep-temp`), plus one kept run of a heredoc-only smoke prompt; criterion 9 holds when `rollout-reported` with the kit ≥ without and no other grader of the two cases drops; record the tables in `docs/EVALS.md`. If it doesn't hold, stop and report to the user.
- [x] Commit `docs: verify gate 0.25.0` in both repos; delete this task file before finishing (git-workflow)

### Review round 1 (2026-10-11)

Three reviews of b949de1 / 2972a49: With fixes, With fixes, No. Fixes, each RED first:

### Task R1: content-only fingerprint with HEAD, cap

**Files:** Modify `lib/worktree.ts` (both editions, byte-identical) · Test `tests/worktree.test.ts` (both)
**Interfaces:** `treeFingerprint(projectDir, ignore): Tree | undefined` with `Tree = { head: string; files: Record<string, string> }`; `changedPaths(before: Tree, after: Tree, projectDir: string): string[]`; `MAX_ENTRIES = 5000`

- [ ] Failing tests: `staging and committing are not changes` (write, fingerprint, `git add -A`, `git commit` → `[]` each step); `checkout after a change is a change`; `an edit and a commit in one step show the file` (clean before, edit+commit → `["src/a.ts"]`); `a tree over the cap has no fingerprint` (5,001 untracked files → `undefined`)
- [ ] Implement per decision 9; `HEAD` from `git rev-parse HEAD` (unborn → `""`), touched files from `git diff --name-only <old> <new> -- .` relative to the prefix
- [ ] Run tests in both editions → PASS; commit `fix(verify): staging and commits aren't edits; an edit committed in one step is`

### Task R2: Claude hooks

**Files:** Modify `lib/hooks.ts`, `lib/state.ts`, `lib/commands.ts`, `skills/verify/SKILL.md`, `scripts/verify.ts` header · Test `tests/hooks.test.ts`, `tests/commands.test.ts`

- [ ] Failing tests: green → `git add -A && git commit` → Stop `{}` and a following reviewer verdict counts; `npm test && sed -i …` → Stop blocks naming the file; `npm test; cat > src/a.ts <<EOF` → blocks; a failed `npm test` after an fs write → blocks; a heredoc body line `npm test` in `cat > Makefile <<EOF` doesn't exempt; the focus 1 and 3 tests follow the shell call with `bash("npm test")` and still block (duplicate test removed); broken `.claude/verify.json` → block naming the error; no detected command enters the reviewer's allowlist or the review gate's Inconclusive rule; an unreadable `Makefile` doesn't throw; SessionStart on `resume` with a tree compares instead of replacing; a session without a tree uses the command text; after a git timeout the session uses the command text
- [ ] Implement per decisions 2, 7, 8, 10, 11: PreToolUse stores `pending[tool_use_id] = tree`; PostToolUse(+Failure) compares with it (and the gap since `state.tree`), marks, then credits; fingerprint taken before the state is loaded, merged so a refresh never clears `unverified`; `resolveVerifyCommands(cwd, { detect })`, `detect: false` for the review-gate callers; Makefile read in `try`; `gitOff` in state
- [ ] Docs: `skills/verify/SKILL.md:7`, `lib/commands.ts` docstring, `scripts/verify.ts` header, README verify gate (attribution, review gate stays configured-only, broken verify.json)
- [ ] Full suite + typecheck → PASS; commit `fix(verify): attribute changes per command, exempt only clean verification runs`

### Task R3: pi verify extension

**Files:** Modify `extensions/verify.ts`, `extensions/guard.ts` (configured-only callers), `extensions/lib/commands.ts` · Test `tests/extensions.test.ts`

- [ ] Failing tests mirroring R2 (`tool_call` snapshot by `toolCallId`; commit after green → no follow-up and `verifyState.unverified` false; chained write and failed run mark; `run_verification` after an fs write with exec code 1 → follow-up names the file; its own writes don't; broken `.pi/verify.json` → follow-up naming the error; without a UI, changes between tool calls don't count)
- [ ] Implement per decisions 2, 7, 8, 10, 11; header and `run_verification` description updated; README/CHANGELOG clauses (landing steps stay configured-only; no notice without a UI)
- [ ] Full suite + typecheck → PASS; commit `fix(verify): pi attributes changes per tool call, exempts only clean verification runs`

Then: re-run the eval of Task 6 for `db-required-column` (criterion 9 again), update EVALS.md/CHANGELOG/ARCHITECTURE, delete this task file, re-review both branches with the round-1 findings.

## Progress

- Execution: inline (user, 2026-10-10).
- Drift: none (`git diff d52179d..HEAD -- lib tests` and `0cc4f39..HEAD` in pi are empty).
- Pre-flight: Task 4 and 5 consume `treeFingerprint`, `changedPaths`, `shellWriteTargets` (Tasks 1–2) and `resolveVerifyCommands`/`"detected"` (Task 3) with the signatures as written; no conflicts.
- Baseline: kit verify script → all 4 checks PASS (typecheck + test in src and src_claude).
- Task 1: complete (d52179d..c46a65f, `node --test tests/worktree.test.ts` → 4 FAIL on assertions (stub `{}`/`[]`), then 4 PASS; `npm test` → 417 pass; typecheck clean). Porcelain paths are repo-relative, so the prefix comes from `git rev-parse --show-prefix`.
- Task 2: complete (c46a65f..bff7099; pi 0cc4f39..42eec2f, `shellWriteTargets` test FAIL on assertion (stub `[]`), then PASS; `npm test` → 418 (eng-kit) and 408 (pi) pass; typecheck clean; `lib/worktree.ts` byte-identical). Ruling: operators are found on `blankQuoted` text and targets read at the same offset, because the tokenizer drops redirect operators — cost if wrong: a quoted `>` target with a space is missed outside git only.
- Task 3: complete (bff7099..ff8a0e3; pi 42eec2f..ef863f1, the detection test FAIL on assertion (source `"none"`), then PASS; `npm test` → 419 / 409 pass; typecheck clean). The move left `readdirSync` unused in both `init.ts`: removed. Side effect, intended by the description: the review gate's "unverified edits" check, the verify script and pi's `run_verification` now also use detected commands.
- Task 4: complete (ff8a0e3..60dc88f: test-only commit 2fa7d42 seen failing on `decision`, then 6 new tests FAIL on assertions, then 35/35 PASS; `npm test` → 426 pass; typecheck clean). The two over-marking guards (verification run that writes, no fingerprint yet) passed before the change: each was proven by mutation (exemption removed → FAIL; baseline rule removed → FAIL). The first guard was too weak (the writing run came first) and was strengthened before the commit. Ruling: Stop also re-compares and saves the tree even when it returns `{}` — the plan's "compares once more"; cost if wrong: one extra git status per stop.
- Task 5: complete (pi ef863f1..aa613d5, 4 new tests FAIL on assertions, then 32/32 PASS in extensions.test.ts; `npm test` → 414 pass; typecheck clean; the over-marking guard proven by mutation). Ruling: pi had no test expecting a follow-up without commands, so there was no test to change in its own commit. Ruling: pi now lists the changed paths in the follow-up (as Claude does), since the new test names `src/a.ts`; `run_verification` refreshes the fingerprint so its checks' own writes don't count.
- Task 6: complete (60dc88f..87bca4d; pi aa613d5..2972a49; kit verify script → 4/4 PASS). Measurement ($3.24 + control $1.58): db-required-column rollout-reported 3/3 with the kit (gate fired in all 3) vs 3/3 without, expand-contract 3/3 vs 2/3; tdd-discount red-before-green 1/3 vs 0/3 with skill loaded 1/3. Stopped as the plan says and ran a control: 0.24.0 (`main`) and the branch, 5 runs each, both 4/5 loaded and 4/5 red; the user agreed to continue. Live smoke: a heredoc-only write without tests was sent back naming `src/a.ts`.
- Ruling: using-skills' verification line keeps "A Stop hook returns you once if files changed since the last green run" (already true for shell changes) and says "runs the project's checks" instead of listing verify.json and CLAUDE.md, since commands can now be detected; the body is at the 800-word cap, so the plan's "(also from the shell)" would not fit — cost if wrong: an agent doesn't learn from the bootstrap that shell writes count (the gate still enforces it).
- Ruling: GETTING-STARTED (both editions) also changed: its "no commands" troubleshooting entry described the old send-back.
