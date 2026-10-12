# The guard reads only what the shell will run

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: b5a03ddf5b9f493857840bc0f1c99e3f1d1b1fe4 (eng-kit) · 030fa7d64d5d8bc1bea08d88049f21435f365daf (pi)
Links: follow-up of 0.25.0; the pi edition's branch of the same name

<details><summary>Original request</summary>

"давай разбирать критичные задачи" — the second one: the guard's false refusal of `rm -r … 2>/dev/null`. The user chose to fix both redirect targets and heredoc bodies fed to a non-shell command, and approved the design in chat (2026-10-12).

</details>

## Intent

The command guard of both editions judges only what the shell will actually run, so writing a script through a heredoc or silencing `rm -r` with `2>/dev/null` isn't refused, while every real delete, force-push or secret read is still caught.

## Context

`checkCommand` (`lib/patterns.ts`) tokenizes the whole command: the `rm -r` check takes redirect targets as paths to delete (`rm -rf build 2>/dev/null` → "Recursive delete of /dev/null"), and heredoc bodies are read as commands, so `cat > a.py <<EOF` whose body mentions `rm -r` or `git push --force` is refused. `heredocs()` in `lib/shell.ts` finds `<<` inside quotes too, which is right for finding hidden landings but wrong for dropping lines.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | `rm -rf build 2>/dev/null`, `rm -rf build >/dev/null 2>&1`, `rm -rf build &>/dev/null` and `git rm -rq x 2>/dev/null` are allowed | unit: `checkCommand`, both editions |
| 2 | `rm -rf ~/x 2>/dev/null`, `rm -rf ../x >/dev/null` and `rm -rf /etc 2>&1` are still blocked | unit |
| 3 | `cat > a.py <<'EOF'` and `python3 - <<EOF` whose body has `rm -r ~/x`, `git push --force` or `npm publish` are allowed | unit |
| 4 | `bash <<EOF`, `sh -s <<EOF` and `ssh host <<EOF` with those bodies are blocked or asked as today | unit |
| 5 | A substitution in an unquoted body is still checked (`cat > f <<EOF` with `$(rm -rf ~/x)` → blocked); a quoted `<<'EOF'` body runs none and is allowed | unit |
| 6 | A `<<` inside quotes hides nothing: `echo "<<EOF"`, then `rm -rf ~/x`, then `EOF` → blocked | unit |
| 7 | Everything 0.25.1 blocked or asked outside heredoc bodies and redirect targets still is | unit: existing guard tests pass unchanged; review against 0.25.1 |

## Scope

**In scope:** a `shellText(command)` helper in `lib/shell.ts` (byte-identical in both editions); `checkCommand` and the `rm -r` check in `lib/patterns.ts` (both editions); tests; README guard notes; CHANGELOG 0.25.2 in both editions.

**Out of scope:** the review gate, the verdict-record protection and the working-docs gate (their own parsing reads heredoc bodies on purpose); the user's `block`/`confirm`/`allow` regexes (still matched against the full command).

## Decisions

1. A heredoc body stays commands only when its segment names a shell: `bash`, `sh`, `zsh`, `dash`, `ksh`, `fish`, `ash`, `busybox` or `ssh` (user, 2026-10-12). Otherwise the body is replaced by its `$(…)` and backtick substitutions (they run in an unquoted body even for `cat`).
2. `<<` counts only outside quotes; the body ends at its delimiter line (`<<-` strips leading tabs), as in `heredocs()`.
3. The built-in checks (`rm -r`, `--no-verify`, force-push, `CONFIRM_RULES`, push checks, secret paths) read `shellText(command)`; user rules read the full command.
4. The `rm -r` check reads its arguments after `stripRedirects`.

## Design

- `shellText(command: string): string` in `lib/shell.ts`: walk lines; on a line, find `<<[-]?['"]?WORD` outside quotes (via `blankQuoted`); decide shell or not from that line's segment words; keep the operator line, then either keep the body lines or emit the body's substitutions (from `quotedSubstitutions` over the unquoted body), and keep the delimiter line out.
- `checkCommand`: `const text = shellText(command)`; segments from `tokenize(text)`; `checkPushSetup`/`checkPushes`/`CONFIRM_RULES` get `text`; user regexes keep `command`.
- `checkSegment` rm branch: `words` of `tokenize(stripRedirects(segment text))` — since segments are token arrays, the rm check moves to `checkCommand` over `splitSegments(tokenize(stripRedirects(text)))`.

## Rollout

None: plugin release 0.25.2 in both editions (pi skips 0.25.1).

## Risks and open questions

- A shell reached through a wrapper not in the list (`docker exec -i c sh`) counts as a shell because `sh` is in its segment; an interpreter that runs shell from its body (`python3 - <<EOF` with `os.system`) is not checked — the guard can't read Python, and checking its text for shell words protected nothing.
- `shellText` drops lines from what the guard sees, so a mistake there hides commands → criterion 6 and the review against 0.25.1 check it; the parser only drops a body when the `<<` is outside quotes.

## Follow-ups

None.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** `checkCommand` judges `shellText(command)`, and `rm -r` ignores redirect targets.
**Architecture:** one pure helper in the shared `lib/shell.ts`; `checkCommand` in `lib/patterns.ts` uses it in both editions.
**Stack / constraints:** Node ≥ 22.18; no new dependencies; `lib/shell.ts` byte-identical in both editions; `lib/patterns.ts` changes identical in both; commits without trailers.
**Verification:** the kit verify script from the workspace (typecheck + test in both editions).

### Review focus
1. A heredoc with `<<-` and tab-indented delimiter, and two heredocs on one line (Task 1).
2. A heredoc whose delimiter never comes (unterminated): the rest is body (Task 1).
3. `sudo bash <<EOF`, `env sh <<EOF` count as shell (Task 1).

### Post-implementation
- README of each edition: the guard paragraph says heredoc bodies fed to a non-shell command are data and redirect targets aren't delete paths.
- `CHANGELOG.md` 0.25.2 in both; versions in `package.json`, `package-lock.json` (and `.claude-plugin/plugin.json`).
- `docs/ARCHITECTURE.md`/`.ru.md`: the guard row, if it describes heredoc handling.

### Task 1: `shellText`

**Files:** Modify `src_claude/lib/shell.ts` (copied to `src/extensions/lib/shell.ts`) · Test `src_claude/tests/guard.test.ts` (copied to pi)

- [ ] Failing tests `shellText keeps what a shell runs`: `cat > a <<'EOF'⏎rm -r x⏎EOF` → no `rm`; `cat > a <<EOF⏎$(rm -rf ~/x)⏎EOF` → contains `rm -rf ~/x`; `bash <<EOF⏎rm x⏎EOF` and `sudo bash <<EOF…`, `ssh h <<EOF…` → body kept; `echo "<<EOF"⏎rm x⏎EOF` → `rm x` kept; `cat <<-EOF⏎⇥rm x⏎⇥EOF⏎ls` → no `rm`, `ls` kept; unterminated `cat <<EOF⏎rm x` → no `rm`. Stub returns its input.
- [ ] Run → FAIL on assertions; implement per decisions 1–2; run → PASS
- [ ] Commit `feat(guard): shellText keeps only what the shell will run`

### Task 2: `checkCommand` reads `shellText`; `rm -r` ignores redirect targets

**Files:** Modify `src_claude/lib/patterns.ts`, `src/extensions/lib/patterns.ts` · Test `tests/guard.test.ts` (both)

- [ ] Failing tests for criteria 1–6 through `checkCommand` (expected actions as in the table)
- [ ] Run → FAIL; implement decisions 3–4; run the full suite in both editions → PASS with the existing guard tests unchanged (criterion 7)
- [ ] Commit `fix(guard): redirect targets aren't delete paths; non-shell heredoc bodies are data` in both repos

### Task 3: docs and version

- [ ] Post-implementation items; kit verify script → all PASS; commit `docs: 0.25.2` in both; delete this task file

## Progress

- Description and plan approved together by the user (2026-10-12); inline.
