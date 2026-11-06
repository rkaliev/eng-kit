# The verify gate credits a verification run that finished in the background

Status: design approved (2026-11-06)
Base: 7d10aa2
Links: None

<details><summary>Original request</summary>

давай разберемся тогда с таким кейсом часто встречаю, не помниаю почем, выходит такое сообщение

> Stop hook error: Verify gate: files changed since the last passing verification. Changed since the last green run: … Run `node ".../eng-kit/0.33.0/scripts/verify.ts"` …

(Then, on the proposed fix: "да".)

</details>

## Intent

An agent whose project checks take longer than the shell call allows, or that starts them in the background, gets its passing run counted, so the verify gate stops sending it back for checks that already passed and it never starts a second full run alongside the first.

## Context

In 12 recent sessions of a real monorepo the gate fired 63 times; 29 came after a run of `scripts/verify.ts` in the background: 21 started with `run_in_background`, 8 moved there by Claude Code's 10-minute shell limit. PostToolUse returns before crediting such a run (`lib/hooks.ts`, "A background run reports success when it starts"), and when the run ends nothing reads its record, so the Stop gate fires even after the run exited 0. Each background-task notification is a new prompt that resets `reminded`, so the gate fires again and the agent starts another full run, sometimes while the first still runs (trace: session 5b93e7ae, 08:59–09:10).

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | A verify-script run this session started in the background that finished green, with the configured commands and no change to the project after it started, clears the gate at the next Stop or tool call | unit, `tests/hooks.test.ts` |
| 2 | The same for a foreground call that Claude Code moved to the background (its PostToolUse result names no outcome) | unit, `tests/hooks.test.ts` |
| 3 | A run that failed, ran other commands, finished before the launch, or started before the last edit is not credited | unit, one test per case |
| 4 | A change found after the run started (an edit, a shell write, a change the Stop snapshot finds) keeps the gate unverified | unit |
| 5 | While this session's background run is still going (its process alive), Stop does not send the agent back to run the checks; once the run is over, the gate judges by its record | unit |
| 6 | A launch whose process died without a record no longer holds the gate silent: the gate sends the agent back as today | unit |
| 7 | A run started by another session or process (no launch noted in this session) is never credited in the background path | unit |
| 8 | Foreground runs behave exactly as before | existing `tests/hooks.test.ts` stay green unchanged |
| 9 | Live: in a project whose verify takes longer than a fast stub, a background run finishes and the gate stays silent at the next Stop | manual: one `claude -p` run with a slow stub verify command — it needs the real harness's background notification, agreed 2026-11-06 |

## Scope

**In scope:**
- `scripts/verify.ts`, `lib/state.ts` (run record), `lib/hooks.ts` (PreToolUse launch note, PostToolUse and Stop crediting), their tests;
- `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `CHANGELOG.md`, version 0.36.0; workspace `docs/FRAMEWORK-SOURCES.ru.md` section.

**Out of scope:**
- the pi edition: its `run_verification` tool runs in-process and its bash tool has no background mode, so the defect doesn't exist there (the shared files touched here are not shared byte-for-byte);
- making verification faster or splitting it; the gate's reminder for genuine edits after a green run;
- which files a project's `ignore` excludes.

## Decisions

1. Credit a background run from the record the script writes, tied to a launch this session noted, not from the call's result (user, 2026-11-06).
2. Fail closed: any doubt (no launch, record from before the launch, a change after the run's start, unreadable record) leaves the gate as it is today.
3. While the run is alive, Stop stays silent instead of asking for a new run, so no parallel runs (user, 2026-11-06).
4. **assumed:** process liveness by `process.kill(pid, 0)` on the pid the script records; a reused pid at worst keeps the gate silent until the next Stop after the notification, never credits anything.

## Design

- **Run record** (`lib/state.ts`): `RunRecord` gains `startedAt` and an optional `pid`; `verify.ts` writes `{running: true, pid, startedAt, commands}` before running and the finished record (`ok`, `startedAt`, `finishedAt`) after. `readRun` keeps accepting an old record without `startedAt` (treated as unknown start: never credited in the background path). The foreground path keeps reading `finishedAt` only, unchanged.
- **Launch note** (session state `verifyLaunch: {at}`): PreToolUse of a call `runsVerifyScript` accepts (same rule as today, background allowed) records `at = now`.
- **Settle** (one helper, called first in PostToolUse of any tool and in Stop): with a launch noted, read the record. Finished, `startedAt >= launch.at`, `ok`, same commands and `startedAt >= state.editedAt` → clear the gate as a green run does; finished otherwise → drop the launch. Not finished and the pid alive → keep the launch (running). No record from after the launch and no live pid → drop the launch.
- **Stop:** the trackTree snapshot runs first (as now), so a change during the run moves `editedAt` past `startedAt`. Then settle; if a launch is still running, skip the verify reminder (other gates unchanged).
- PostToolUse of the background call itself keeps returning without crediting.

## Rollout

Ships as eng-kit 0.36.0. A session started on an older version reads a newer record fine (extra fields ignored); a record without `startedAt` is never credited in the background, so mixed versions only keep today's behaviour.

## Risks and open questions

- A record written by a concurrent run of another session for the same project after this session's launch could be credited → acceptable: it ran the same commands against the same tree after the last edit; the tree check still applies.
- A run killed by the user without a record leaves the gate silent only while its pid lives.

## Follow-ups

- Guard: `.GIT` case and hook files outside `.git` (known paths plus `core.hooksPath`), decided 2026-11-06.

## Plan

None yet

## Progress

None yet
