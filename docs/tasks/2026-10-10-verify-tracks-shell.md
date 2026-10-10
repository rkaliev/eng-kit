# The verify gate sees shell edits and keeps the final report whole

Status: design approved (2026-10-10)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: <set by writing-plans>
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
2. The fingerprint is rolling: taken at SessionStart (pi: `session_start`), compared after every shell command (also a failed one) and once more at Stop, and refreshed after every edit; changes made by a verification run don't mark.
3. A project without configured commands gets detected ones; if none are found, the gate only notifies, once per session. Chosen by the user; it relaxes the 0.24.0 behaviour for that case only.
4. The send-back text asks for the complete final report again: costs one more report's tokens, keeps `-p`/CI output whole. Chosen by the user.
5. Shared library files stay byte-identical between the editions (`lib/worktree.ts`, `lib/shell.ts`); `lib/commands.ts` keeps its per-edition file names.
6. **assumed:** a Stop hook's JSON output with `systemMessage` and no `decision` shows the text to the user without blocking; checked with a live run before the code relies on it.

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
- `systemMessage` behaviour (decision 6) is unverified → live probe first; if it doesn't show, ask the user for an alternative before coding that part.

## Follow-ups

- The guard's `rm -r … 2>/dev/null` false positive (`lib/patterns.ts:161`).
- Eval graders still judged on the trace in legacy-change and db-required-column; `sed -i` with `|` or `;` in the order graders.

## Plan

None yet

## Progress

None yet
