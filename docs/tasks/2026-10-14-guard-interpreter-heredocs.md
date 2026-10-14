# The guard stops blocking comments and strings in a python or node heredoc

Status: in progress (plan approved 2026-10-14)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 21ac6b05a416c7b610fd1578859cb4bd12f47eb9 (pi: 1db4e105a37efc25599ee0fb03201eb630f19e85)
Links: FRAMEWORK-SOURCES §11.34 (0.25.2 file-write heredocs)

<details><summary>Original request</summary>

"дава1 3 и 4 пункты делать" — item 4: "Heredoc для интерпретаторов (`python3 - <<'EOF'`) guard по-прежнему читает как команды, это ложные срабатывания." Choice: "Вопросы да, блоки нет (Recommended)"; design and the test change approved: "да" (2026-10-14).

</details>

## Intent

An agent can run a one-off python or node script through a heredoc without the guard blocking it for a comment or string that looks like a shell command, while the guard still asks about what the code may do (drop a table, publish, push).

## Context

`checkCommand` in `lib/patterns.ts` (both editions) tokenizes the whole command, so a python comment `# rm -rf ~/cache` or a docstring with an apostrophe makes `checkSegment` block. `os.system("rm -rf ~/x")` and `shutil.rmtree` already pass, so the block rules protect nothing real in such a body. 0.25.2 exempted whole-command quoted-heredoc file writes the same way (`fileWriteHeredoc`).

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | A whole-command interpreter heredoc — first line exactly `python`, `python3` or `node`, optional ` -`, then `<<'W'`/`<<"W"`/`<<-'W'`, nothing else; the delimiter is the last line and appears nowhere earlier; no control character but `\n`/`\t` — is not blocked for its body: `# old: rm -rf ~/cache`, `'''Don't run rm -r ~/x'''`, `// rm -rf ../shared later`, a body line `rm -rf ~/x`, `git commit --no-verify` in a string → allow | unit: `guard: an interpreter heredoc's body isn't read as shell for the block rules` |
| 2 | Every ask still reads the whole command: `cur.execute("DROP TABLE payments")` → confirm, `subprocess.run('npm publish', shell=True)` → confirm, `print("git push --force origin main")` → confirm, a user `confirm`/`block` rule matching the body → confirm/block | unit: `guard: an interpreter heredoc still asks about what its code may do` |
| 3 | Anything outside criterion 1 is judged as before: `bash <<'EOF'`, `sh <<'EOF'`, `python3 <<EOF` (unquoted), `python3 - x <<'EOF'`, `python3 -c '…'`, `python3 - <<'EOF' | sh`, a line after the delimiter, an earlier delimiter line, `node --input-type=module - <<'EOF'`, a `\r` in the body — each with body `rm -rf ~/x` → block | unit: `guard: other interpreter forms are judged as before` |
| 4 | Every other existing guard test passes unchanged, except the one row moved by Decision 3 | `npm test` in both editions |

## Scope

**In scope:** `checkCommand` and the heredoc recognizer in `lib/patterns.ts` (both editions), `tests/guard.test.ts` (both), README "What the guard reads", CHANGELOG 0.25.4, versions 0.25.4.

**Out of scope:** the review gate's `hiddenLanding`, `checkGateFiles`, `workDocs` (still read the whole command); other interpreters (ruby, perl, deno, bun); interpreter arguments; `-c` one-liners.

## Decisions

1. For an interpreter heredoc only `checkSegment` (the block rules that read shell words) reads the first line; push checks, `CONFIRM_RULES`, user rules and secret paths read the whole command (user, 2026-10-14).
2. Interpreters: `python`, `python3`, `node`, with or without ` -` (user, 2026-10-14).
3. The 0.25.2 test row `python3 - <<'EOF'⏎rm -rf ~/x⏎EOF` → block in "every other heredoc and <<-like shape is judged as before" is removed in its own commit and its new outcome (allow) pinned under criterion 1 (user agreed, 2026-10-14).

## Design

Generalize `fileWriteHeredoc` to `quotedHeredoc(command)`: the same line, delimiter and control-character checks, with a second head family `INTERPRETER_HEADS` (`^(?:python3?|node)(?:[ \t]+-)?[ \t]+${QUOTED_DELIMITER}[ \t]*$`). It returns `{ head, target? }` — `target` only for a file write. `checkCommand` keeps the file-write path as is; for an interpreter head the `checkSegment` loop runs over the head's segments, and every other check over the whole command's.

## Rollout

None. Patch release 0.25.4 in both editions.

## Risks and open questions

- Interpreter code can still do anything (it always could: `os.system`, `shutil.rmtree`); the guard documents that it doesn't read code in other languages.

## Follow-ups

- `${NAME:=v}` in the verify text fallback; `find . … > $TMPDIR/x` false mark (from 0.25.3).

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** the block rules skip the body of a whole-command python/node quoted heredoc; asks still read it.
**Architecture:** one recognizer in `lib/patterns.ts` for both heredoc kinds; `checkCommand` chooses the text `checkSegment` reads. Both editions carry the same function text.
**Stack / constraints:** Node ≥22.18 `.ts`; no dependencies; same code in both `patterns.ts`; version 0.25.4 in `package.json`, `package-lock.json`, `.claude-plugin/plugin.json` (eng-kit) and `src/package.json`/lock; commits without trailers.
**Verification:** the kit verify script from the workspace root.

### Review focus
1. A body that makes a later line run as shell (a delimiter repeated, `\r`, a pipe on the head).
2. `git push --force` in the body: must ask, not pass silently.
3. A user `block` rule matching the body still blocks.
4. `node -` vs `node` with other flags.

### Post-implementation
- README (both): "What the guard reads" adds the interpreter heredoc.
- CHANGELOG (both): `## 0.25.4`.
- Topic chapter: README guard section; no decision record.

### Task 1: move the 0.25.2 row (both editions)

**Files:** Test `tests/guard.test.ts` (both)

- [ ] Remove `` `python3 - <<'EOF'\n${del}\nEOF`, `` from the "judged as before" list; run guard tests → PASS.
- [ ] Commit `test(guard): stop pinning a python heredoc body as shell` (body: Decision 3, user agreement).

### Task 2: interpreter heredocs (both editions)

**Files:** Modify `lib/patterns.ts` / `extensions/lib/patterns.ts` · Test `tests/guard.test.ts` (both)
**Interfaces:** Produces internal `quotedHeredoc(command): { head: string; target?: string } | undefined`

- [ ] Append the three tests of criteria 1–3.
- [ ] Run guard tests → criterion 1 FAILS on assertions (block ≠ allow); criteria 2–3 pass (pins).
- [ ] Implement as in Design; copy the function text to pi.
- [ ] Run both suites → PASS; mutations: no interpreter heads, `node` with any flag, asks read only the head, `checkSegment` reads the whole command, control-character check off → each fails a test.
- [ ] Commit `fix(guard): read a python or node heredoc body as code, not shell`.

### Task 3: docs and 0.25.4

- [ ] README, CHANGELOG, versions; kit verify script → PASS; commit `docs: 0.25.4`; delete this task file; review both branches.

## Progress

None yet
