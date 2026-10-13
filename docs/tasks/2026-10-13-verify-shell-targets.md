# The verify gate doesn't count shell writes to home, temp or variable paths as project edits

Status: in progress (plan approved 2026-10-13)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 7b902af35cefadd4ee6071e38f902e3227d80483 (pi: 084a7e2929a67a926e003e518b764ce645612dd1)
Links: FRAMEWORK-SOURCES §11.32 (0.25.0, where the text fallback was added)

<details><summary>Original request</summary>

"дава1 3 и 4 пункты делать" — item 3 of the follow-ups: "Verify gate при записи через shell (`> $S/t.log`) берёт путь как есть, с `$`, и считает его изменённым файлом. Так он ложно отправлял меня обратно на перепроверку в этой сессии." Design approved in chat: "да, пиши план".

</details>

## Intent

Outside git, the verify gate stops sending the agent back for a shell write to a file outside the project that it named through `~` or a variable, while a write it can't place still counts.

## Context

Outside git (or past 5,000 files, or once git timed out), `shellWriteTargets` in `lib/worktree.ts` (byte-identical in both editions) reads write targets from the command text and resolves them against the command's folder. `~/notes.txt`, `$HOME/n`, `$TMPDIR/n` and `$S/t-$e.log` (with `S=/private/tmp/…` set in the same command) are all counted as project files today.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | `~` and `~/…` targets resolve to the home folder: `echo x > ~/notes.txt` → `[]` | unit: `shellWriteTargets: home, environment and assigned variables are expanded` |
| 2 | `$NAME` and `${NAME}` take the value of a plain assignment in the same command (`NAME=v`, `export NAME=v`), else the environment: `$HOME/n`, `${HOME}/n`, `$TMPDIR/n` with TMPDIR=/tmp/t → `[]`; `OUT=src && echo x > $OUT/a.ts` and `export OUT=src; echo x > $OUT/a.ts` → `["src/a.ts"]`; `P=<project>; echo x > $P/src/a.ts` → `["src/a.ts"]` | same unit test |
| 3 | When a part can't be expanded (unknown variable, `$(…)`, backtick), the literal part before it decides: an absolute path outside the project → not counted (`S=/tmp/x && npm test > $S/t-$e.log` → `[]`); otherwise counted as written (`> $UNKNOWN/a.ts` → `["$UNKNOWN/a.ts"]`, `> src/$name.ts` → `["src/$name.ts"]`, `> "$(mktemp)"` → `["$(mktemp)"]`) | unit: `shellWriteTargets: a target that can't be expanded is judged by its literal start` |
| 4 | Everything the existing `shellWriteTargets` test pins is unchanged | the existing test, unmodified |

## Scope

**In scope:**
- `shellWriteTargets` in `lib/worktree.ts` of both editions; tests in both `tests/worktree.test.ts`; README, ARCHITECTURE and CHANGELOG 0.25.3 in both.

**Out of scope:**
- The git fingerprint path (unaffected), the guard, `$(…)` evaluation, `~user`, variables set by `for`/`read`, `${NAME:-x}` and other parameter operators (treated as unknown).

## Decisions

1. Unknown parts fail closed: the gate's job is not to miss an edit, so a target that may be in the project is counted (user approved the design 2026-10-13).
2. An assignment anywhere in the same command counts, whatever its position (best effort, like the rest of the text fallback); a prefix assignment (`NAME=v cmd`) does not, since the shell doesn't expand it for that command. **assumed**
3. The environment is the hook's (`process.env`, injectable for tests); `~` is `env.HOME`, else `os.homedir()`. **assumed**

## Design

`shellWriteTargets(command, cwd, projectDir, env = process.env)`. Before the existing `resolve`/`relative` step, each target goes through `expandTarget(target, vars, home)`:
- `vars` = the environment overlaid with plain assignments found in the command's segments (a segment that is only `NAME=value` words, or `export` followed by them; quotes already removed by the tokenizer).
- `~` or a leading `~/` → home. `$NAME` / `${NAME}` (NAME = `[A-Za-z_]\w*`) → its value. A value that itself has `$` is not expanded again.
- The first part that stays unexpanded (`$`, a backtick) cuts the target: if the literal start is an absolute path (after expansion) outside the project, the target is dropped; otherwise the original text is kept and counted as before.

## Rollout

None. Patch release 0.25.3 in both editions.

## Risks and open questions

- A variable whose value differs between the hook's environment and the agent's shell (set in an earlier command) → the gate may place a write wrongly; same class as before, and an unknown variable still counts.

## Follow-ups

- Item 4: interpreter heredocs (`python3 - <<'EOF'`) are read as shell by the guard's block rules — next task, its own branch and task file.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** `shellWriteTargets` expands `~` and known variables and drops targets that land outside the project.
**Architecture:** One private helper in `lib/worktree.ts` (shared byte-for-byte with `src/extensions/lib/worktree.ts`), called on each found target before the in-project filter; `env` becomes an optional parameter. Callers (`lib/hooks.ts`, pi's verify extension) are unchanged.
**Stack / constraints:** Node ≥22.18 running `.ts` directly; no dependencies; both `worktree.ts` copies stay byte-identical; versions 0.25.3 in `package.json`, `.claude-plugin/plugin.json` (eng-kit) and `src/package.json`; commits without trailers.
**Verification:** `node "<kit root>/scripts/verify.ts"` from the workspace root (typecheck + tests of both editions).

### Review focus
1. `$S` assigned *and* `$e` unknown in one target (criterion 3, the case that started this).
2. A variable whose value is inside the project (must still count).
3. `${NAME}` braces and `export NAME=v`.
4. A prefix assignment `OUT=x cmd > $OUT/a` must not use `x`.

### Post-implementation
- README (both): the verify-gate paragraph's "outside git … targets count instead" gains "with `~` and variables expanded; a target outside the project doesn't count".
- docs/ARCHITECTURE.md (both): same clause in the hook table row / verify row.
- CHANGELOG.md (both): `## 0.25.3` entry.
- Topic chapter: the README verify-gate section; no decision record (no lasting ruling beyond Decision 1, recorded in CHANGELOG).

### Task 1: expand targets in shellWriteTargets (both editions)

**Files:** Modify `src_claude/lib/worktree.ts`, `src/extensions/lib/worktree.ts` · Test `src_claude/tests/worktree.test.ts`, `src/tests/worktree.test.ts`
**Interfaces:** Produces `shellWriteTargets(command: string, cwd: string, projectDir: string, env?: NodeJS.ProcessEnv): string[]`

- [ ] Append test `shellWriteTargets: home, environment and assigned variables are expanded` with the criterion 1–2 values (env `{ HOME: <tmp home outside project>, TMPDIR: "/tmp/t" }`), plus `OUT=x echo y > $OUT/a.ts` with env without OUT → `["$OUT/a.ts"]` (focus 4); and test `shellWriteTargets: a target that can't be expanded is judged by its literal start` with the criterion 3 values. Add the `env` parameter (unused) so the tests compile.
- [ ] Run `node --test tests/worktree.test.ts` in each edition → expect FAIL on assertions (e.g. expected `[]`, received `["~/notes.txt"]`).
- [ ] Implement the private `expandTarget` and assignment collection in `src_claude/lib/worktree.ts` as in Design; copy the file to `src/extensions/lib/worktree.ts`; `cmp` the two.
- [ ] Run both suites → PASS; mutation-check: no `~`, no assignments, no env, no literal-start cut, prefix assignment honoured → each fails a test.
- [ ] Commit `fix(verify): expand home and variables in shell write targets` in each repo.

### Task 2: docs and version 0.25.3 (both editions)

**Files:** Modify `README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `package.json` (+ `.claude-plugin/plugin.json` in eng-kit) in each repo

- [ ] Apply the Post-implementation edits; bump to 0.25.3.
- [ ] Run the kit verify script from the workspace root → all PASS.
- [ ] Commit `docs: 0.25.3`; delete this task file (`docs: remove the task file for the verify target fix`); then review both branches.

## Progress

None yet
