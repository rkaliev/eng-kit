# The behavior check runs model-written code without secrets or write access

Status: in progress
Base: 12b9717
Links: None

<details><summary>Original request</summary>

давай 1

(Option 1 of three: run the behavior check's child process with an empty environment (PATH only) and Node's permission model — reads limited to the run's temp folder and the case's check, no writes, no child processes. The user chose it after the review showed that eval runs execute the same code inside the eval sandbox, while the behavior check ran it on the host with the user's environment, home and network.)

</details>

## Intent

Running `scripts/eval-behavior.ts` can't leak the maintainer's tokens or change their files, because the model-written code it executes sees no secrets and can only read what the check needs.

## Context

`scripts/eval-behavior.ts` (0.27.0) spawns `eval-behavior-runner.ts` with the parent's whole environment and no restrictions. In the eval the same code ran inside the eval sandbox (network blocked, writes limited, a temporary home); here it runs on the host. The docs commit 107b069 on this branch described it as "the same code the agent already ran", which the review found misleading.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | The child process gets an environment with only `PATH`: a variable set in the parent (a token) is not visible to the run's code | test: a check returning `process.env.EVAL_BEHAVIOR_SECRET` gets `undefined` while the parent has it set |
| 2 | The child runs under Node's permission model: writing any file, starting a child process, and reading a file outside the run's temp folder, the case's folder and the runner fail with `ERR_ACCESS_DENIED` | test rows: a check that tries each one reports the error code |
| 3 | The permission flag is `--permission` where Node has it and `--experimental-permission` otherwise (Node 22.18–23.4), so the script works on every Node the kit supports | CI matrix (Node 22 and 24) runs the tests; the flag choice is a function with a unit row |
| 4 | Existing behavior holds: the real `bug-root-cause` and `spec-timeout` checks, fd 3 results, timeouts, no evidence, early exit | the existing `tests/eval-behavior.test.ts` rows pass unchanged |
| 5 | Docs state what is and isn't isolated: no secrets, no writes, no child processes, reads limited; network not restricted (Node's permission model doesn't cover it) | script header and EVALS.md; review |

## Scope

**In scope:**
- `scripts/eval-behavior.ts` spawn options; tests; the script header and EVALS.md; CHANGELOG 0.27.1 (Claude edition only, as 0.25.1 was).

**Out of scope:**
- blocking the network (not in Node's permission model on the supported versions);
- the pi edition (no evals there).

## Decisions

1. Option 1: empty environment plus Node's permission model. (user, 2026-10-17)
2. A Claude-edition-only patch release 0.27.1; pi stays at 0.27.0 (precedent: 0.25.1). (user, 2026-10-17)

## Design

- `permissionFlag(): string` returns `--permission` if `process.allowedNodeEnvironmentFlags.has("--permission")`, else `--experimental-permission`.
- `check()` spawns `process.execPath` with `[flag, --allow-fs-read=<temp dir>, --allow-fs-read=<case dir>, --allow-fs-read=<runner>, RUNNER, behaviorPath, target]`, `env: { PATH: process.env.PATH ?? "" }`, the existing stdio/timeout/killSignal.

## Rollout

None.

## Risks and open questions

- Node 22's experimental permission model may print a warning on stderr → only fd 3 carries the result; stderr is read only on a non-zero exit.
- A run's code that needs another file of the fixture fails to import (already true: only one file is written out).

## Follow-ups

- None.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** isolate the behavior check's child process.
**Architecture:** spawn options in `scripts/eval-behavior.ts`; rows in `tests/eval-behavior.test.ts`; docs.
**Stack / constraints:** Node ≥ 22.18 (CI 22 and 24), `node --test`, no dependencies, no commit trailers.
**Verification:** `npm test && npm run typecheck` (kit verify script); `claude plugin validate .`.

### Review focus
1. A path is allowed that lets the code read the maintainer's files (a parent folder of the temp dir, the repo root).
2. The flag choice on Node 22 (experimental flag, warnings on stderr).
3. An env variable other than PATH leaks (spread of process.env anywhere).
4. Existing rows weakened to pass.

### Post-implementation
- `scripts/eval-behavior.ts` header, `docs/EVALS.md` intro: what is isolated and what isn't.
- `CHANGELOG.md` 0.27.1; `package.json`, `package-lock.json`, `.claude-plugin/plugin.json` 0.27.1.

### Task 1: isolation

**Files:** Modify `src_claude/scripts/eval-behavior.ts` · Test `src_claude/tests/eval-behavior.test.ts`

- [x] Write test `the run's code sees no secrets and can't write, spawn or read outside`: parent sets `EVAL_BEHAVIOR_SECRET=s3cret`; a check returns `["env:" + process.env.EVAL_BEHAVIOR_SECRET]` plus the error codes of `writeFileSync(<tmpdir>/eval-behavior-probe)`, `execSync("true")`, `readFileSync(<a file in the test's own temp root outside the run dir>)` → expect `env:undefined`, three `ERR_ACCESS_DENIED`
- [x] Run → expect FAIL (env:s3cret, writes allowed)
- [x] Implement `permissionFlag()` and the spawn options; row: `permissionFlag()` is one of the two flags and is accepted by `process.allowedNodeEnvironmentFlags`
- [x] Run the file → PASS, then the full suite; commit `fix(evals): run the behavior check without secrets or write access`

### Task 2: docs and release

- [ ] Replace the 107b069 wording in the header and EVALS.md with criterion 5's statement; CHANGELOG 0.27.1; versions; commit `docs: 0.27.1`

## Progress

- Plan approved 2026-10-17, inline. Baseline: kit verify script PASS both editions (eng-kit 477 tests).
- Task 1: complete. RED: the new test got `env:s3cret`, `write:allowed`, `spawn:allowed`, `read:allowed`, and the flag row got an empty flag. First GREEN attempt failed every run with "Access to this API has been restricted": the check path was passed unresolved (`/var/…`) while the allowed path was resolved (`/private/var/…`). Ruling: pass realpath'd check, runner and temp dir to the child — cost if wrong: none, same files. GREEN 8/8 on Node 24.19 and on Node 22.18 (`npx node@22.18.0`, `--experimental-permission`, several `--allow-fs-read`); kit verify script PASS both editions.
