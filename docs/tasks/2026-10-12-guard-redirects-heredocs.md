# The guard stops refusing two harmless shapes, and nothing else

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: b5a03ddf5b9f493857840bc0f1c99e3f1d1b1fe4 (eng-kit) · 030fa7d64d5d8bc1bea08d88049f21435f365daf (pi)
Links: the pi edition's branch of the same name; review round 1 of the first design (No, No, With fixes)

<details><summary>Original request</summary>

"давай разбирать критичные задачи" — the second one: the guard's false refusal of `rm -r … 2>/dev/null`. First design (approved 2026-10-12): a `shellText` parser that read only what the shell runs. Review round 1 found it fails open — over ten ordinary forms (`<<<`, `$((1<<20))`, `#` comments, `$(ssh <<EOF)`, `cat <<EOF | $SHELL`, `psql <<SQL` with `DROP`, a script written and run in one command…) hid later commands that 0.25.1 caught. The user chose to redesign fail-closed (2026-10-12): only `/dev/null` and a whole-command file write.

</details>

## Intent

The command guard of both editions stops refusing two harmless shapes — `rm -r` silenced with `/dev/null`, and a command that only writes a file through a quoted heredoc — while every other command is judged exactly as in 0.25.1.

## Context

`checkCommand` (`lib/patterns.ts`) tokenizes the whole command: `rm -rf build 2>/dev/null` yields the word `/dev/null`, which the `rm -r` check takes for a path outside the project; and a heredoc body is read as commands, so writing a file whose text mentions `rm -r`, `git push --force` or `npm publish` is refused or asked. Modelling which shell text runs failed open (review round 1), so this design widens nothing it can't state exactly.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | `rm -rf build 2>/dev/null`, `rm -rf build >/dev/null 2>&1`, `rm -rf build &>/dev/null` and `git rm -rq x 2>/dev/null` are allowed | unit: `checkCommand`, both editions |
| 2 | `rm -rf ~/x 2>/dev/null`, `rm -rf ../x >/dev/null` and `rm -rf /etc 2>&1` are still blocked | unit |
| 3 | A whole-command file write is judged by its first line only, so a body with `rm -r ~/x`, `git push --force origin main` or `npm publish` is allowed: `cat > a.py <<'EOF'`, `cat >> notes.md <<"EOF"`, `cat <<'EOF' > s.sh`, `tee -a log.txt <<'EOF'`, `cat > a <<-'EOF'` with a tab-indented delimiter | unit |
| 4 | Every other heredoc is judged as in 0.25.1 (that body still blocked): an unquoted delimiter; a path with `$`, quotes or spaces; anything else on the first line (`\|`, `;`, `&&`, `$(`, a second command); a line after the delimiter (`bash s.sh`); the delimiter appearing twice; no closing delimiter; `python3 - <<'EOF'`, `psql <<'SQL'` (asks on `DROP TABLE`), `bash <<'EOF'`, `out=$(ssh h <<'EOF'`, `cat <<'EOF' \| bash`; and the non-heredoc shapes `cat <<< x`, `echo $((1<<4))`, a `#` comment with `<<EOF` — each followed by `rm -rf ~/x` | unit |
| 5 | The first line still counts: `cat > .env <<'EOF'` asks (secret file); `cat > ../x <<'EOF'` behaves as 0.25.1 | unit |
| 6 | Everything 0.25.1 decided outside criteria 1 and 3 is unchanged | unit: the existing guard tests pass unchanged; review against 0.25.1 |

## Scope

**In scope:** `checkCommand` and the `rm -r` check in `lib/patterns.ts` of both editions; reverting this branch's `shellText` (`lib/shell.ts` back to 0.25.1, byte-identical in both); tests; README guard note; CHANGELOG 0.25.2 in both.

**Out of scope:** any other heredoc or interpreter form (`python3 -`, `node -`, database clients) — the user chose not to widen them; the review gate, the verdict-record protection and the working-docs gate; the user's guard.json patterns (still matched against the full command).

## Decisions

1. In the `rm -r` check, the word `/dev/null` is not a delete target. Redirections are not stripped (stripping hid commands in review round 1).
2. A command is a file write when, as a whole, it is: a first line matching exactly `cat >`/`cat >>` path then `<<`/`<<-` and a quoted delimiter (`'W'` or `"W"`), or the same with the redirection after the delimiter, or `tee [-a] path <<'W'`, with nothing else on the line; then body lines; then the delimiter as the last non-empty line (with `<<-`, after leading tabs), appearing nowhere earlier. The path is `[A-Za-z0-9_./~@+-]+` (no `$`, backtick, quote, space or glob). (User, 2026-10-12.)
3. For a file write, the built-in checks read the first line only; user rules read the full command.
4. `shellText` and this branch's change to `lib/shell.ts` are reverted.

## Design

- `lib/patterns.ts`: `fileWriteHeredoc(command: string): string | undefined` returns the first line when decision 2 holds; `checkCommand` uses `const text = fileWriteHeredoc(command) ?? command` for segments, push checks, `CONFIRM_RULES` and secret paths; the rm check filters out `/dev/null` (back inside `checkSegment`, as in 0.25.1).
- Both editions get the same function and edits; `lib/shell.ts` returns to its 0.25.1 content.

## Rollout

None: plugin release 0.25.2 in both editions (pi skips 0.25.1).

## Risks and open questions

- A file written by a whole-command heredoc may itself be dangerous (a script with `rm -rf ~`), but writing it runs nothing; running it is a later command the guard reads as before.
- `rm -rf /dev/null` (as root) is no longer refused by this check; it unlinks a device node, not a tree, and needs root.

## Follow-ups

- Interpreter heredocs (`python3 - <<'EOF'`) stay read as commands; the kit's agents write such scripts with Write.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** the two shapes pass; everything else is judged as in 0.25.1.
**Architecture:** one function in `lib/patterns.ts` recognises a whole-command file write; the rm check ignores `/dev/null`.
**Stack / constraints:** Node ≥ 22.18; no new dependencies; identical edits in both editions; `lib/shell.ts` byte-identical with 0.25.1; commits without trailers.
**Verification:** the kit verify script from the workspace.

### Review focus
1. `<<-` with tabs before the delimiter, and a trailing newline after it (Task 2).
2. A body line equal to the delimiter with trailing spaces (Task 2: not the delimiter, so the real one must still be last).
3. `cat>a.py<<'EOF'` without spaces (Task 2: allowed or judged as 0.25.1 — either is safe; the test pins which).

### Post-implementation
- README guard note in both editions: `/dev/null` and whole-command file writes; CHANGELOG 0.25.2 in both (replacing the first design's text); versions already 0.25.2.

### Task 1: revert the first design

- [x] Restore `lib/shell.ts`, `lib/patterns.ts` and `tests/guard.test.ts` to the base in both editions (`git checkout <base> -- …`); run both suites → PASS (0.25.1 behaviour)
- [x] Commit `revert(guard): drop shellText — it failed open (review round 1)` in both repos

### Task 2: the two shapes

**Files:** Modify `lib/patterns.ts` (both editions) · Test `tests/guard.test.ts` (both)

- [x] Failing tests for criteria 1–5 (exact actions: `allow`/`block`/`confirm`), including the Review focus cases
- [x] Run → FAIL on criteria 1 and 3 assertions (4–5 pass already: they pin 0.25.1 behaviour); implement decisions 1–3; run both suites → PASS, existing guard tests unchanged
- [x] Mutation: drop the `/dev/null` filter → criterion 1 fails; accept an unquoted delimiter, a line after the delimiter, or a `$` in the path → criterion 4 fails
- [x] Commit `fix(guard): /dev/null isn't a delete target; a whole-command quoted heredoc file write is judged by its first line` in both repos

### Task 3: docs

- [x] README and CHANGELOG 0.25.2 in both editions; kit verify script → all PASS; commit `docs: 0.25.2`; delete this task file

## Progress

- Redesigned description and plan approved together by the user (2026-10-12); inline.
- Task 1: complete (revert d4f2258 / pi 8e10c0b; suites 449 / 429 PASS; `lib/shell.ts` byte-identical with 0.25.1).
- Task 2: complete (7bb1d6c / pi db71362; criteria 1 and 3 FAIL on assertions before, criteria 4–5 pass before by design; then 453 / 433 PASS; mutations: no /dev/null filter, unquoted delimiter, lines after the delimiter, `$` in the path — each fails its test; existing guard tests unchanged). Ruling: pi's patterns.ts has no `const TEMP_ROOTS` line, so the function is inserted before `checkSegment` there; the function text is identical.
- Task 3: complete (README note and CHANGELOG 0.25.2 rewritten for the new design in both; kit verify script → 4/4 PASS).
