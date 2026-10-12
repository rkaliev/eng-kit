# Only a real run of the kit's verify script counts as one

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 8d9ec79ad7817ba0b2a87b0847296d592d799022
Links: follow-up of 0.25.0 (reviewers' out-of-scope note: `runsVerifyScript` matches its path anywhere)

<details><summary>Original request</summary>

"давай разбирать критичные задачи"; then: start with the false "verified" first; only the kit's own script counts as a run.

</details>

## Intent

The verify gate treats only a real run of the kit's verify script as one, so reading, grepping or editing a file of that name can't mark unchecked code as verified.

## Context

`runsVerifyScript` (`lib/hooks.ts:358`) is `/scripts[\\/]verify\.ts\b/` over the whole command. When it matches and no run record exists, an unpiped exit code 0 clears the workspace (`lib/hooks.ts:287`). Reproduced on 0.25.0: after an Edit, `cat <kit>/scripts/verify.ts` makes Stop return `{}`.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | After an edit, `cat <kit>/scripts/verify.ts`, `grep x <kit>/scripts/verify.ts`, `sed -n 1p <kit>/scripts/verify.ts`, `node <project>/scripts/verify.ts` and `cd x && node <kit>/scripts/verify.ts` leave the workspace unverified: Stop sends Claude back | unit: hooks test, one Stop per command |
| 2 | `node "<kit>/scripts/verify.ts"`, the same with `2>&1 \| tail -30`, and with `\| tee log` count as runs | unit: `runsVerifyScript` test |
| 3 | The existing verify-gate tests pass; the three `runsVerifyScript` unit assertions change only their arguments (`root`, `cwd`), in their own commit (user agreed, 2026-10-12) | unit: full suite |
| 4 | Every run of the bootstrap's command that 0.25.0 credited is still credited | review against 0.25.0 |

## Scope

**In scope:** `runsVerifyScript` and its two call sites in `lib/hooks.ts`; tests; README verify gate; CHANGELOG 0.25.1; version 0.25.1 in the Claude edition.

**Out of scope:** the pi edition (no verify script); the guard's `rm -r … 2>/dev/null` false positive (next task); other follow-ups of 0.25.0.

## Decisions

1. Only the kit's own script counts: `node <path>` where the path resolves (against the call's `cwd`, with `\` read as `/`) to `<kit root>/scripts/verify.ts` (user, 2026-10-12).
2. It must be the command's only working segment; `tail`, `head`, `grep` or `tee` may follow it after `|` (the script records its own result). `2>&1` and other redirections are ignored as before.
3. Heredoc bodies are not commands (as in `verificationOnly`).

## Design

`runsVerifyScript(shell: string, root: string, cwd: string): boolean` in `lib/hooks.ts`, built from `heredocs`, `stripRedirects`, `tokenize` and the separators `verificationOnly` uses. The predicate passed to `verificationOnly` (`lib/hooks.ts:267`) checks one segment's words with the same path rule.

## Rollout

None: plugin release 0.25.1 (Claude edition only; pi skips it).

## Risks and open questions

- An agent that runs the script with another launcher (`npx tsx …`, `bun …`) is no longer credited → the bootstrap and the gate's reason name the exact `node "<root>/scripts/verify.ts"` command; the agent can also run the listed commands.

## Follow-ups

- The guard's `rm -r … 2>/dev/null` false positive (both editions).

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** `runsVerifyScript` accepts only a real run of the kit's script.
**Architecture:** one function in `lib/hooks.ts` reads the command's segments; both call sites use it.
**Stack / constraints:** Node ≥ 22.18, no new dependencies; reuse `heredocs`/`stripRedirects` (`lib/shell.ts`) and `tokenize` (`lib/patterns.ts`); commits without trailers.
**Verification:** `node "<kit>/scripts/verify.ts"` from the workspace (typecheck + test in both editions).

### Review focus
1. A Windows-style path (`node C:\k\scripts\verify.ts` with root `C:\k`) still counts (Task 2).
2. A relative path from the project root (`node .claude/eng-kit/scripts/verify.ts` in a project install) counts (Task 2).
3. A quoted path with spaces (`node "/a b/scripts/verify.ts"`) counts (Task 2).

### Post-implementation
- `README.md` verify gate "What counts as a green run": the verify script run by the bootstrap's command, optionally piped into `tail`/`head`/`grep`/`tee`; a mention of the path doesn't count.
- `CHANGELOG.md` 0.25.1; version 0.25.1 in `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`.
- `docs/ARCHITECTURE.md` and `.ru.md`: the PostToolUse row names the green-run rule; check and update if it describes the script match.

### Task 1: the three existing unit assertions take `root` and `cwd`

**Files:** Test `tests/hooks.test.ts:129-131`

- [x] Change the calls to `runsVerifyScript(<same command>, "/k", "/p")` (Windows case: root `C:\k`), assertions unchanged; add a stub signature `runsVerifyScript(shell, root, cwd)` that ignores the new arguments
- [x] Run `node --test tests/hooks.test.ts` → PASS (no behaviour change)
- [x] Commit `test(verify): runsVerifyScript takes the kit root and the call's folder` (user agreed, 2026-10-12)

### Task 2: only a real run counts

**Files:** Modify `lib/hooks.ts` · Test `tests/hooks.test.ts`

- [x] Write failing tests: `runsVerifyScript recognises only a run of the kit's script` — true for `node "/k/scripts/verify.ts"`, `node /k/scripts/verify.ts 2>&1 | tail -30`, `node /k/scripts/verify.ts | tee log`, `node "/a b/scripts/verify.ts"` (root `/a b`), `node .claude/eng-kit/scripts/verify.ts` (root `/p/.claude/eng-kit`, cwd `/p`), the Windows case; false for `cat /k/scripts/verify.ts`, `grep x /k/scripts/verify.ts`, `sed -n 1p /k/scripts/verify.ts`, `node /p/scripts/verify.ts`, `cd x && node /k/scripts/verify.ts`, `cat > notes <<'EOF'⏎node /k/scripts/verify.ts⏎EOF`. And `verify gate: mentioning the verify script doesn't clear it` — after an Edit (no run record), each of criterion 1's commands → Stop `decision: "block"`.
- [x] Run `node --test tests/hooks.test.ts` → expect FAIL on the false cases (the regex returns true)
- [x] Implement per decisions 1–3; pass `env.root` and `input.cwd || env.projectDir` at both call sites
- [x] Run the full suite and typecheck → PASS; commit `fix(verify): only a run of the kit's verify script counts as one`

### Task 3: docs and version

- [x] Post-implementation items; kit verify script → all PASS; commit `docs: 0.25.1`; delete this task file before finishing

## Progress

- Description and plan approved by the user together (2026-10-12); execution inline.
- Task 1: complete (64ac318..30e689d; three assertions' arguments only; 49/49).
- Task 2: complete (30e689d..06daa69; both new tests FAIL on assertions, then PASS; mutations: path `endsWith` instead of equality → 2 tests fail; readers without a pipe → fails after adding `node …; tail -5 log`). Ruling: the recorded-run test used a made-up `/kit` path the loose match accepted; its command now uses the real kit path, assertions unchanged, own commit 9f8e2a7 (passes on the old code too) — cost if wrong: none. Ruling: backslashes read as `/` before tokenizing, so a PowerShell/cmd path counts; a bash escape misread only fails the match.
- Task 3: complete (docs + 0.25.1; kit verify script → 4/4 PASS, eng-kit 448).
