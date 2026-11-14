# Verify gate asks only for the checks that cover the changed files

Status: design approved (2026-11-14)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 336df00
Links: None

<details><summary>Original request</summary>

The user pasted five verify-gate send-backs from two of their projects, most of them for Markdown edits, for example:

> Stop hook error: Verify gate: files changed since the last passing verification. Changed since the last green run: docs/backlog.md. Run `node "<kit>/scripts/verify.ts"` (its output is already short) or: `pnpm format:check`, `pnpm test:scripts`, `pnpm turbo run typecheck lint test`, `pnpm test:alone`, `pnpm bdd`, and read the output.

Asked what to do (the firings are correct for those projects' verify.json, but a one-file doc edit runs all five checks), the user chose «Пути у команд», then «Отдельная карта» for the config format, and approved design sections 1–3 («да»).

</details>

## Intent

A project whose checks cover different files can say so in verify.json, so the verify gate asks for, and the verify script runs, only the checks that cover what changed: a doc edit in a monorepo whose prettier checks Markdown costs `pnpm format:check`, not five suites with a 900 s timeout.

## Context

Every counted edit resets `green` to empty (`lib/hooks.ts` `markEdited`, Edit/Write branch of `postToolUse`), so all commands are owed again; a verify-script run clears the gate only when it ran exactly the configured list (`sameCommands`). `ignore` is all-or-nothing: a project can't ignore docs when prettier checks them, or when its own check validates Markdown. Transcripts show the gate fires once per set of edits since 0.38.3; the remaining cost is the size of each run.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | With `paths` mapping the other commands to code folders, an edit of only `docs/x.md` makes the Stop reason name only the uncovered command(s), as `node "<kit>/scripts/verify.ts" --only "<cmd>"` plus the plain command | hooks unit test |
| 2 | A verify-script run with `--only` that passed every owed command clears the gate; one that missed an owed command does not | hooks unit tests (record with subset ⊇ owed; record missing one) |
| 3 | Owed commands accumulate: `.md` edit then `.ts` edit owes the union; a passed run of a subset removes only what it ran | hooks unit test |
| 4 | An edit that no command covers leaves the workspace verified (no send-back, `edited`/`editedAt` unchanged) | hooks unit test |
| 5 | An edit of `.claude/verify.json`, or of an unknown file, owes every command | hooks unit tests |
| 6 | Without `paths`, behavior is unchanged: every counted edit owes every command; bare verify script runs all | existing hooks/verify tests stay green unchanged |
| 7 | `verify.ts --only <cmd>` (repeatable) runs those commands in config order and records only them; an unknown command exits 2, runs nothing, writes no result record | verify script unit tests |
| 8 | Invalid `paths` entries (not a non-empty string array) make that command cover everything; unknown keys are ignored; both are reported once per session in a Stop `systemMessage` and as a line in the verify report | commands + hooks unit tests |
| 9 | The gate credits `node "<kit>/scripts/verify.ts" --only "<cmd>"` like the bare call (piped into tail is fine); `cd`, `&`, a project-dir argument still don't count | `runsVerifyScript` unit tests |
| 10 | pi: `run_verification` takes optional `only: string[]` with the same rules, and the follow-up names only owed commands | pi extension tests |
| 11 | A real Claude Code session on a temp project with `paths`: a doc edit is sent back with `--only`, the agent's run clears the gate | manual live check `claude -p` — needs a real model session, agreed 2026-11-14 |

## Scope

**In scope:**
- `paths` in `.claude/verify.json` / `.pi/verify.json`, owed-command tracking, `--only` in the verify script, `only` in pi `run_verification`, gate wording, docs (README verify.json section, ARCHITECTURE(.ru), CHANGELOG), version 0.39.0 in both editions.

**Out of scope:**
- `paths` for commands from CLAUDE.md/AGENTS.md or detected ones; kit-init generating `paths`; changing `ignore`; editing any project's verify.json.

## Decisions

1. Config is a separate map `"paths": {"<command text>": ["<glob>", …]}` (user, «Отдельная карта»): a kit that doesn't know the field owes every command, the fail-safe direction.
2. A command without an entry covers every path; `ignore` still applies first.
3. The gate names the subset to run (`--only`); the script doesn't infer it from git, because commits inside the session would hide edits the gate still owes and cause re-fires.
4. A bare verify run (user `/verify`, before a PR) still runs every command.
5. Invalid entries fail closed (command covers everything); `--only` with an unknown command runs nothing.
6. Globs match the project-relative path with the existing `isIgnored` glob syntax; in a workspace, a repository's own verify.json `paths` are not read (**assumed**: only the session folder's verify.json, like `commands`).

## Design

**`lib/commands.ts`** (both editions): `VerifyConfig.paths?: Record<string, unknown>`; `resolveVerifyPaths(cwd, commands)` returns `{ scopes: Map<string, string[]>, problems: string[] }` for commands from verify.json only; `owedCommands(changed: string[], commands, scopes)` returns, in config order, the commands some changed path matches, every command for an unknown path or `.claude/verify.json` (`.pi/verify.json`).

**State** (Claude `lib/hooks.ts`, pi `extensions/verify.ts`): `markEdited` and the Edit/Write branch compute owed commands for the paths; base green is `state.green` when unverified, else all commands; `green = base − owed`; nothing owed → state untouched. `unverified = commands.some(c => !green.has(c))` as today.

**Crediting:** a passed fresh run record (`postToolUse` verify branch, `settleLaunch`) adds `run.commands` to `green` and recomputes `unverified`, replacing `sameCommands(run.commands, commands)`; the start/`editedAt` freshness rules stay. The unpiped-exit-code fallback (no record) credits only for a bare run, since it can't tell which commands ran.

**Stop reason:** owed = commands not in `green`. If owed is all commands, the text is as today; else `Run \`node "<kit>/scripts/verify.ts" --only "<c1>" --only "<c2>"\` … or: \`<c1>\`, \`<c2>\``. Path problems → one `systemMessage` per session (`pathsNoted` flag).

**`scripts/verify.ts` / `lib/verify-run.ts`:** parse `--only <command>` pairs before the optional project-dir; `runVerification(cwd, run, only?)` filters the resolved list, keeps config order, errors (exit 2, no record) on a command not in the list; report adds path problems as a `Note:` line.

**`runsVerifyScript` / `isKitScript`:** after the script path, accept only `--only <word>` pairs.

**pi:** `run_verification` gets `only: Type.Optional(Type.Array(Type.String()))`; the follow-up names owed commands and `run_verification` with `only`.

## Rollout

Minor release 0.39.0 in both editions; additive config field, no migration. Rollback: drop `paths` from a project's verify.json.

## Risks and open questions

- An agent reruns the full script anyway → still credited (superset); only cost is lost, not correctness.
- A too-narrow `paths` lets a change skip a check → the project owns its map; README warns and CI still runs everything.
- Session state from 0.38.x (`green` = all or empty) stays valid under the new rules.

## Follow-ups

- kit-init could propose `paths` from the manifest layout (turbo workspaces, prettier globs).
- Per-repository `paths` in a workspace.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** `paths` in `.claude/verify.json` makes the verify gate owe, name and credit only the commands whose globs cover the changed files.
**Architecture:** `lib/commands.ts` reads the map and computes owed commands; `lib/hooks.ts` keeps `green` per command (an edit removes only the owed ones) and names the owed subset with `--only`; `scripts/verify.ts` runs a subset and records what it ran, and a passed record adds its commands to `green`.
**Stack / constraints:** Node ≥ 22.18 running `.ts` directly, no new dependencies, `node:test`; glob syntax = `globToRegExp`; without `paths` every existing test passes unchanged (criterion 6). Version 0.39.0.
**Verification:** `npm test`, `npm run typecheck` (`.claude/verify.json` absent: CLAUDE.md commands), run as the kit verify script from the workspace root.

### Review focus
- A record from a run that started before the last edit, with the owed subset, must not credit (freshness rules unchanged when crediting a subset).
- Unpiped exit-code fallback (no run record) for `--only`: must not clear commands it can't prove ran → credits only a bare run.
- Owed set when `green` came from 0.38.x state (`green: []`, `unverified: true`) → every command owed, as before.
- `--only` value with shell metacharacters inside quotes (`--only "a && b"`) is one word to `runsVerifyScript` and isn't matched by `commandMatches` as a run of `a`.
- Shell-detected changes (`trackTree` → `markEdited`) owe by path the same way as Edit/Write.

### Post-implementation
- `README.md` § verify gate (lines ~116–120): `paths` map, owed subset, `--only`, warning that a narrow map skips checks locally (CI still runs all).
- `docs/ARCHITECTURE.md` + `.ru.md`: verify gate state (`green` per command, owed), `--only`.
- `skills/verify/SKILL.md` ("no arguments"), `skills/executing-plans/SKILL.md:39`, `skills/verification-before-completion/SKILL.md:17`: the script runs bare, or with exactly the `--only` the gate names.
- `skills/kit-init/SKILL.md`: one line that `paths` exists (not generated).
- `CHANGELOG.md` 0.39.0, `package.json` + `.claude-plugin/*` version 0.39.0 (whatever `release.test.ts` checks).
- Topic chapter: README § verify gate describes the feature; no decision record (the rule lives in the README).

Files:
- Modify `lib/commands.ts`: `paths` in `VerifyConfig`, `resolveVerifyPaths`, `owedCommands`.
- Modify `lib/verify-run.ts`: `parseVerifyArgs`, `runVerification(cwd, run, only)`.
- Modify `scripts/verify.ts`: use them; exit 2 on a bad `--only`.
- Modify `lib/state.ts`: `SessionState.pathsNoted?: boolean`.
- Modify `lib/hooks.ts`: owed edits, crediting, Stop wording, `isKitScript`.
- Test `tests/commands.test.ts`, new `tests/verify-run.test.ts`, `tests/hooks.test.ts`.

### Task 1: owed commands from `paths`

**Files:** Modify `lib/commands.ts` · Test `tests/commands.test.ts`
**Interfaces:** Produces `resolveVerifyPaths(cwd: string, commands: string[]): { scopes: Map<string, string[]>; problems: string[] }` and `owedCommands(changed: string[], commands: string[], scopes: Map<string, string[]>): string[]`; exports `VERIFY_FILE = ".claude/verify.json"`.

- [ ] Write failing tests (stubs return `{ scopes: new Map(), problems: [] }` and `[...commands]`):
  - `owedCommands`: scopes `{test: ["src/**"]}`, commands `["fmt","test"]`: `["docs/a.md"]` → `["fmt"]`; `["src/a.ts"]` → `["fmt","test"]`; scopes covering both commands with `["x.txt"]` matching none → `[]`; `["(unknown file)"]` and `[".claude/verify.json"]` → all, in config order.
  - `resolveVerifyPaths`: valid map → scope for the command; key not in commands → not in scopes, problem `paths: "npm tset" is not one of the commands`; value `[]`, `"src/**"`, `[1]` → not in scopes, problem `paths: "npm test" needs a non-empty list of globs`; `paths` not an object → one problem `paths must be an object`; no verify.json / commands from CLAUDE.md → empty map, no problems.
- [ ] Run `node --test tests/commands.test.ts` → expect FAIL on the `["fmt"]` assertion (received `["fmt","test"]`)
- [ ] Implement in `lib/commands.ts`; read `paths` only when `resolveVerifyCommands(cwd).source === ".claude/verify.json"`
- [ ] Run `node --test tests/commands.test.ts` → PASS, then the full suite
- [ ] Commit `feat(verify): owed commands from verify.json paths`

### Task 2: `verify.ts --only`

**Files:** Modify `lib/verify-run.ts`, `scripts/verify.ts` · Create `tests/verify-run.test.ts`
**Interfaces:** Consumes Task 1 · Produces `parseVerifyArgs(argv: string[]): { only: string[]; dir?: string; error?: string }`, `runVerification(cwd, run?, only?: string[]): VerifyReport` with `VerifyReport.exitCode: 0 | 1 | 2`.

- [ ] Write failing tests with a fake runner and a temp project (`commands: ["a","b","c"]`):
  - `parseVerifyArgs(["--only","a","--only","c"])` → `{ only: ["a","c"] }`; `["/p"]` → `{ only: [], dir: "/p" }`; `["--only"]` → error `--only needs a command`.
  - `only: ["c","a"]` runs `a` then `c` (config order), `commands` = `["a","c"]`, report has no line for `b`.
  - `only: ["zz"]` → runs nothing, `exitCode` 2, report `--only "zz" is not one of the verification commands`.
  - verify.json with a bad `paths` entry → report contains `Note: paths: "b" needs a non-empty list of globs`.
  - no `only` → runs a, b, c (unchanged).
- [ ] Run `node --test tests/verify-run.test.ts` → expect FAIL: runs `["a","b","c"]` where `["a","c"]` expected
- [ ] Implement; `scripts/verify.ts` writes no start or result record when `exitCode === 2`, records `commands` = the commands run selected
- [ ] Run the test file → PASS, then the full suite
- [ ] Commit `feat(verify): run a subset of the commands with --only`

### Task 3: the gate recognises `--only`

**Files:** Modify `lib/hooks.ts` (`isKitScript`) · Test `tests/hooks.test.ts` (`runsVerifyScript recognises only a run of the kit's own script`)

- [ ] Add rows: true for `node /k/scripts/verify.ts --only "npm test"`, `… --only "npm test" --only "npm run lint" 2>&1 | tail -5`, `… --only "a && b"`; false for `… --only`, `… --only a extra`, `… /p`, `… --all`, `cd x && node /k/scripts/verify.ts --only a`, `… --only a &`
- [ ] Run `node --test tests/hooks.test.ts` → FAIL on the first `--only` row (false)
- [ ] Implement: after the script word, accept only `--only <word>` pairs
- [ ] Run → PASS, full suite
- [ ] Commit `feat(verify): credit verify runs with --only`

### Task 4: owed edits, subset crediting and the Stop wording

**Files:** Modify `lib/hooks.ts`, `lib/state.ts` · Test `tests/hooks.test.ts`
**Interfaces:** Consumes Tasks 1–3. Replaces `sameCommands(run.commands, commands)` in `postToolUse` and `settleLaunch` with `green ∪ run.commands` then recompute.

- [ ] Write failing tests, project with `.claude/verify.json` `{"commands":["fmt","test"],"paths":{"test":["src/**"]},"ignore":[]}`:
  - C1: Edit `docs/x.md` → Stop reason contains `--only "fmt"` and `` `fmt` `` and not `` `test` ``.
  - C2: then a run record `{ok:true, commands:["fmt"]}` after a verify call with `--only fmt` → next Stop undefined; with a `src/a.ts` edit too and the same record → Stop blocks naming `test`.
  - C3: Edit `docs/x.md` then `src/a.ts` → reason names both and no `--only` (all owed); Bash `fmt` passes → reason after next prompt names only `test`.
  - C4: verify.json `paths` covering both commands with `src/**`; Edit `notes.txt` → Stop undefined and `loadState(...).edited` is `[]`.
  - C5: Edit `.claude/verify.json` → all owed; Edit with no `file_path` → all owed.
  - C8: bad `paths` entry → first Stop has a `systemMessage` naming the problem; a second Stop in the session has none (`pathsNoted`).
  - Review focus: a subset record with `startedAt` before the edit doesn't credit; a bare piped `--only` run without a record doesn't credit; a shell command writing `docs/y.md` (trackTree) owes only `fmt`.
- [ ] Run `node --test tests/hooks.test.ts` → FAIL at C1 (reason lists `test`)
- [ ] Implement:
  - `oweFor(env, state, paths): SessionState` used by the Edit/Write branch and `markEdited`: base = `state.unverified ? state.green : commands`; owed = `owedCommands(paths, commands, scopes)`; nothing owed → state unchanged; else `green = base − owed`, `unverified = true`, `edited`/`editedAt` as today.
  - Crediting: passed fresh record → `green ∪ run.commands`, `unverified = commands.some(c => !green.has(c))`, `edited: []` when verified; the no-record fallback credits only a bare call (no `--only`).
  - Stop: owed = commands not in `green`; subset → `` Run `<script> --only "<c>"…` (its output is already short) or: `c`… ``; all → as today. Path problems → `systemMessage` once (`pathsNoted`), alongside any other message.
- [ ] Run the test file → PASS; full suite, all existing hooks tests unchanged (criterion 6)
- [ ] Commit `feat(verify): owe and credit commands by path`

### Task 5: docs and version

**Files:** those in Post-implementation · Test `tests/release.test.ts`, `tests/lint-skills.test.ts`

- [ ] Update README, ARCHITECTURE(.ru), the three skills, kit-init, CHANGELOG 0.39.0, versions
- [ ] Run the kit verify script from the workspace root → all checks pass (word-count lint on skills)
- [ ] Commit `docs: verify paths`

### Task 6: live check (criterion 11)

- [ ] In a scratchpad git project with `{"commands":["node fmt.mjs","node test.mjs"],"paths":{"node test.mjs":["src/**"]},"ignore":[]}` and the branch plugin (`claude -p --plugin-dir <src_claude>`), ask for a one-line change to `docs/a.md` → transcript shows a send-back with `--only "node fmt.mjs"`, the agent's run, and no second send-back; record cost in Progress

## Progress

None yet
