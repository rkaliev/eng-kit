# The verify gate credits a verification run that finished in the background

Status: in progress
Base: 4d629e2
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

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** a passing verify-script run this session launched counts for the verify gate when it finishes in the background, and Stop stays silent while it runs.
**Architecture:** `verify.ts` writes a start record and a finished record (with `startedAt`); PreToolUse notes the launch in the session state; one `settleLaunch` helper, run in shell PostToolUse after the tree comparison and in Stop after its snapshot, credits or drops the launch by the record.
**Stack / constraints:** Node ≥22.18 running `.ts` directly, `node:test`, no new dependencies; files in English; `lib/state.ts` and `lib/hooks.ts` are Claude-edition only (not byte-shared with pi).
**Verification:** `npm test`, `npm run typecheck`, `claude plugin validate .` (or the kit verify script).

### Review focus
1. The start record of a run in progress overwriting a finished record that a foreground call is about to read → `readRun` returns finished records only (Task 1 test).
2. The background call's own PostToolUse arrives before the script wrote its start record → a launch without a record is kept for `LAUNCH_GRACE_MS` (Task 2 test).
3. A change made while the run is going (by the run itself or anything else) → not credited (Task 2 test).
4. A killed run (dead pid, no finished record) must not silence Stop forever (Task 2 test).
5. A record written by a run nobody in this session launched → never credited by `settleLaunch` (Task 2 test).

### Post-implementation
- `docs/ARCHITECTURE.md` and `docs/ARCHITECTURE.ru.md`, the PostToolUse/Stop rows: the verify script counts also when it runs in the background (launch noted, record after it, no change after its start; Stop silent while it runs) instead of "not sent to the background".
- `scripts/verify.ts` header comment: the start record and that a background run counts.
- `CHANGELOG.md` 0.36.0 entry; `package.json` and `.claude-plugin/plugin.json` version 0.36.0.
- Workspace (outside the repo) `docs/FRAMEWORK-SOURCES.ru.md` §11.47: where it came from (63 firings, 29 after background runs), user decisions, what was done, verification.
- README: none, it doesn't describe how the gate credits runs (check with `grep -n background README.md`).
- Decision record: none, the decisions live in ARCHITECTURE and FRAMEWORK-SOURCES.

### Files

- `lib/state.ts`: run records (`RunRecord.startedAt`, new `RunStart`, `readRun` finished-only, new `readRunStart`) and `SessionState.verifyLaunch`.
- `scripts/verify.ts`: writes the start record before running.
- `lib/hooks.ts`: launch note in PreToolUse, `settleLaunch`, its calls in PostToolUse and Stop.
- `tests/hooks.test.ts`: all new tests.

### Task 1: Run record with a start

**Files:** Modify `lib/state.ts`, `scripts/verify.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Produces `RunRecord { ok: boolean; commands: string[]; finishedAt: number; startedAt?: number }`, `RunStart { running: true; pid: number; startedAt: number; commands: string[] }`, `writeRun(projectDir, record: RunRecord | RunStart, root?)`, `readRun(...)`: `RunRecord | undefined` (finished only), `readRunStart(projectDir, root?)`: `RunStart | undefined`.

- [x] Write failing tests: `verify.ts records its start before running and its start time when done`: verify.json with one command that prints `readFileSync(runFile(projectDir))` and exits 1; assert stdout matches `"running":true` and `"pid":<number>`; then `readRun(projectDir)` has `startedAt` ≤ `finishedAt` and `ok: false`. `readRun ignores a run still in progress; an old record loads without a start`: `writeRun` a `RunStart` → `readRun` is `undefined` and `readRunStart` returns it; a record `{ok, commands, finishedAt}` → `readRun` returns it with `startedAt` undefined and `readRunStart` is `undefined`. Add a stub `readRunStart` returning `undefined`.
- [x] Run `node --test --test-name-pattern="records its start|ignores a run still" tests/hooks.test.ts` → expect FAIL on the `"running":true` match and on `readRunStart` returning `undefined`.
- [x] Implement in `lib/state.ts`; `verify.ts` takes `startedAt = Date.now()`, writes `{ running: true, pid: process.pid, startedAt, commands }` (in its own try/catch) before `runVerification`, and adds `startedAt` to the finished record.
- [x] Run the two tests → PASS, then `npm test` and `npm run typecheck` → all pass.
- [x] Commit `feat(verify): record when a verification run starts`.

### Task 2: Credit a background run this session launched

**Files:** Modify `lib/state.ts` (`verifyLaunch?: number` in `SessionState`, loaded only when a number), `lib/hooks.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Consumes Task 1's records · Produces `settleLaunch(env: HookEnv, sessionId: string, state: SessionState): { state: SessionState; running: boolean }` (module-private), constant `LAUNCH_GRACE_MS = 60_000`.

- [x] Write failing test `verify gate: a background verify run this session launched counts when it finishes green` (criterion 1, the red reproduction): Edit → PreToolUse Bash `node "<root>/scripts/verify.ts"` with `run_in_background: true` → PostToolUse of it → `writeRun` a finished record `{ok: true, commands: ["npm test", "npm run typecheck"], startedAt: now, finishedAt: now}` → Stop output is `undefined`. Add a stub `settleLaunch` returning `{ state, running: false }`.
- [x] Run `node --test --test-name-pattern="launched counts" tests/hooks.test.ts` → expect FAIL: Stop returns `decision: "block"`.
- [x] Write the other tests, each from Edit → PreToolUse launch:
  - criterion 2: the same with no `run_in_background` and a PostToolUse whose result names no outcome → Stop `undefined`; also a later PostToolUse Bash `ls` clears it before Stop;
  - criterion 3, one assertion each, Stop `decision: "block"`: `ok: false`; commands `["npm test"]`; `finishedAt` and `startedAt` before the launch; `startedAt` before the last edit (Edit after the launch, record started before it);
  - criterion 4: Edit after the record's `startedAt` but before Stop → block; a file written into the git repo between the record and Stop (found by Stop's snapshot) → block;
  - criterion 5: `writeRun` a `RunStart` with `pid: process.pid` → Stop `undefined` and `reminded` stays false; then a finished green record → Stop `undefined` and state `unverified: false`;
  - criterion 6: `RunStart` with the pid of an exited `spawnSync(process.execPath, ["-e", ""])` → Stop block; a launch with no record saved 120 s in the past (`saveState` with `verifyLaunch: Date.now() - 120_000`) → Stop block;
  - criterion 7: no PreToolUse launch, a green finished record after the edit → Stop block (the background call's PostToolUse alone credits nothing).
- [x] Implement:
  - PreToolUse: after the snapshot, when the decision is allow and `runsVerifyScript(command, env.root, cwd)`, reload the session state and save it with `verifyLaunch: Date.now()`;
  - `settleLaunch`: no launch → unchanged. A finished record with `finishedAt >= launch`: credit (`unverified: false`, `green: commands`, `edited: []`) only when `ok`, `startedAt !== undefined`, `startedAt >= launch`, `startedAt >= state.editedAt`, commands non-empty and `sameCommands`; either way drop the launch. Else a `RunStart` with `startedAt >= launch` whose pid is alive (`process.kill(pid, 0)`, `EPERM` counts as alive) → `running: true`. Else a launch younger than `LAUNCH_GRACE_MS` → `running: true`. Else drop the launch. Save only when the state changed;
  - PostToolUse (shell): right after `trackTree`, `settleLaunch` on its state and continue with the result;
  - Stop: after `trackTree`, `settleLaunch`; when `running`, skip the verify reminder (don't set `reminded`); the task-file reminders run as before.
- [x] Run the new tests → PASS, then `npm test` (existing verify-gate tests unchanged, criterion 8) and `npm run typecheck` → all pass.
- [x] Commit `fix(verify-gate): count a verification run that finished in the background`.

### Task 3: Docs, version and live check

**Files:** Modify `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `scripts/verify.ts` (header), `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`; workspace `docs/FRAMEWORK-SOURCES.ru.md`.

- [ ] Update the docs as Post-implementation says; bump to 0.36.0.
- [ ] Live check (criterion 9): a scratch git project with `.claude/verify.json` `{"commands": ["node -e \"setTimeout(()=>{},20000)\""]}`, `claude -p --plugin-dir <src_claude>` asked to edit a file, run the kit verify script in the background, wait for it and finish; expect no `Verify gate` block in the stream-json output after the run's notification. Record the result in Progress.
- [ ] `npm test`, `npm run typecheck`, `claude plugin validate .` → all pass.
- [ ] Commit `docs: background verify runs count (0.36.0)`.


## Progress

- Baseline (4d629e2): `npm test` 686 tests, 675 pass, 11 skipped, 0 fail; `npm run typecheck` clean. Drift: none.
- Task 1: complete (28fc208..c8a3376, `npm test` → 677 pass, 0 fail, 11 skipped; typecheck clean). Both tests seen failing first: no `"running":true` in the record, `readRunStart` stub `undefined`.
- Ruling: the moved-to-background test must have the start record written before the call's PostToolUse — the existing PostToolUse fallback "no record → trust an unpiped exit code" credited such a call at once, and with Task 1's start record (which `readRun` ignores) it would have credited every call Claude Code moves to the background — the fallback now also needs no start record — cost if wrong: a script that can't write records falls back to exit codes as before.
- Ruling: criterion 3 is asserted as "not credited" (`unverified` stays true), not as an immediate Stop block — a record finished before a launch younger than 60 s leaves Stop waiting for the launched run's start record, as the design's grace says — cost if wrong: one silent Stop within a minute of a launch.
- Ruling: a verify call reported in the foreground (`ended`) gets no 60 s grace when no start record follows its launch — it is over, or its script couldn't write; found by the existing test "a piped verify script keeps its own writes only while its record says it passed" (Stop went silent) — cost if wrong: none beyond today's behaviour for that call.
- Task 2: complete (c8a3376..HEAD, `npm test` → 684 pass, 0 fail, 11 skipped; typecheck clean). RED seen: launched-green and Stop-waits tests got `block`, the moved-to-background test failed on "its result, reported while the run goes on, proves nothing"; criteria 3, 4 and 7 tests pass before the code by design (they forbid crediting); mutation checks: dropping `startedAt >= editedAt` fails criteria 3 and 4, dropping the pid check fails criterion 6.
