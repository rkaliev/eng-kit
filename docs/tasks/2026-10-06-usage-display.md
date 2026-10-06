# Token usage in the terminal: status line and per-branch ledger

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 669691e51146845fbca6a32f8abb8f4580e3deeb
Links: None

<details><summary>Original request</summary>

а так же давай отдельно пометь что хотелось бы потом побрейнштормить задачу как сделать так чтоб расход токенов отображался прямо в терминале

(Brainstorm answers, 2026-10-06: show the current session, subagents and reviews, subscription limits and per-task history; status line + per-branch ledger in both editions; subagent and task totals in tokens, not dollars; the status line is enabled in the user's settings.)

</details>

## Intent

While the agent works, the user sees in one terminal line how full the context is, what the session and its subagents have used and how close the plan limits are, and at the end of a task what the branch cost in tokens, so expensive habits (long review loops, big subagents) are visible when they happen.

## Context

Claude Code passes a status-line command the session's cost, context use and subscription limits (5-hour and 7-day), but no subagent usage, and a plugin can't set a status line. Hook inputs carry no usage at all (verified on 2.1.291); a subagent's tokens are only in its transcript (`agent_transcript_path`, `message.usage`, an internal format). pi's footer already shows context, session tokens and cost, and an extension can add a status text.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | Claude: the status line prints one line `ctx ▓▓▓▓▓░░░░░ 42% · $1.87 · 5h ▓▓▓▓▓▓▓░░░ 63% ↻14:20 · 7d ▓▓▓▓░░░░░░ 31% · sub 1.2M` from the JSON Claude Code passes it; a missing field is left out (API users have no `rate_limits`), and malformed input prints a short fallback instead of failing | unit: statusline formatter rows for full input, no rate limits, no ledger, malformed JSON |
| 1a | Each percentage has a 10-cell bar (`▓` per started 10 %, `░` for the rest) and is coloured by level: green below 50 %, yellow from 50 %, red from 80 %; with `NO_COLOR` set, the same text has no colour codes | unit: bar and colour rows at 0, 49, 50, 79, 80, 100 %; `NO_COLOR` row |
| 2 | Each subagent run adds one ledger record: branch, agent type, model, input / output / cache-write / cache-read tokens, counted once per message id | unit: ledger from a fixture transcript with a repeated message; hook test for SubagentStop |
| 3 | The main session's tokens are recorded per branch at Stop, so a branch total covers main + subagents across sessions without double counting | unit: two Stop snapshots of one session count once; two sessions add up |
| 4 | `/finish` (and `scripts/usage-log.ts`) prints the branch total by agent type, e.g. `main 3.4M · reviewer 2.1M · implementer 0.8M` | unit: summary rows; finish skill text names the command |
| 5 | An installer command writes `statusLine` into `~/.claude/settings.json` with a path that survives plugin updates; an existing `statusLine` is not replaced without `--force`, and the change is shown first | unit: planner rows (absent, ours, someone else's, invalid JSON) |
| 6 | pi: the guard extension sets a status text `sub 1.2M · branch 5.6M` from the same ledger (subagent usage from the `subagent` tool result) and `/finish` prints the same summary; pi's own footer keeps showing context and session usage, so no bars are added there | unit: pi status text; ledger shared byte-for-byte |
| 7 | Reading or writing the ledger never fails a hook or the status line: an unreadable transcript or ledger is skipped | unit: corrupt ledger line, missing transcript |

## Scope

**In scope:** both editions; a shared `lib/usage.ts` (ledger, transcript reader, summaries), the Claude status-line script and installer, hook wiring, `/finish` summary, docs.

**Out of scope:**
- dollar amounts for subagents and tasks (user decision: tokens);
- a price table;
- per-tool or per-skill attribution (Claude's `/usage` already shows it);
- dashboards or anything outside the terminal.

## Decisions

1. Tokens, not dollars, for subagents and tasks; the status line keeps Claude Code's own session `$` (user, 2026-10-06).
1a. Percentages as mini progress bars, coloured green / yellow / red; thresholds 50 % and 80 % and the 10-cell width are **assumed** defaults (user asked for bars and colours, 2026-10-06).
2. The status line is installed in the user's settings, once for all projects (user, 2026-10-06).
3. Both editions; `lib/usage.ts` shared byte-for-byte like `reviews.ts`.
4. The transcript format is internal: the reader takes only `message.id`, `message.model` and `message.usage` token fields and skips anything else, so a format change degrades to missing numbers, never a failure. **assumed**
5. The ledger lives next to the review records (`<tmpdir>/eng-kit/usage/<hash of the git common dir>.jsonl`), keyed by branch; tmp is acceptable because it is a convenience, not evidence. **assumed**

## Design

- `lib/usage.ts`: `readTranscriptUsage(path)` → tokens per model, deduped by message id; `appendUsage(projectDir, record)`; `branchSummary(projectDir, branch)`; `statusText(input, ledger)` for Claude, `piStatus(ledger)` for pi.
- Claude: `SubagentStop` → `appendUsage` from `agent_transcript_path`; `Stop` → snapshot of the main transcript (latest total per session replaces the previous one); `scripts/statusline.ts` reads stdin JSON + ledger and prints one line; `scripts/usage-log.ts` prints a branch summary; `/finish` calls it.
- Installer: `scripts/statusline-install.ts` writes `{"statusLine": {"type": "command", "command": "node \"<stable path>/scripts/statusline.ts\""}}`; the stable path is the marketplace clone (`~/.claude/plugins/marketplaces/<name>`), not the versioned cache.
- pi: the guard extension appends from the `subagent` tool result's usage and the session's own usage; `ctx.ui.setStatus("eng-kit", …)`.

## Rollout

None: opt-in installer; the ledger starts empty.

## Risks and open questions

- The Claude transcript format may change → reader is defensive (decision 4), and a test pins the fields it reads.
- pi's `subagent` tool result carries usage: verified in pi-subagents 0.76.1 (`SingleResult.usage`, `model`).
- Status-line cost: it runs on every assistant message → reading the ledger must stay cheap (one file, tail only).

## Follow-ups

- Odd backtick in an unquoted heredoc body over-refuses (guard, 0.21.2 follow-up).
- Duplicated `decision()` tail in the hidden + visible landing message (0.21.2 follow-up).

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** a status line with context, session cost, plan limits and subagent tokens, and a per-branch token ledger summarised by `/finish`, in both editions.
**Architecture:** a shared `lib/usage.ts` keeps a JSONL ledger per repository (subagent runs and session snapshots, keyed by branch) and reads Claude transcripts; Claude fills it from SubagentStop/Stop and shows it in `scripts/statusline.ts`; pi fills it from `subagent` results and `agent_end`, and shows it with `ctx.ui.setStatus`.
**Stack / constraints:** Node ≥22.18, `.ts` run directly, no dependencies; `lib/usage.ts` byte-identical in `src_claude/lib/` and `src/extensions/lib/`; ledger and transcript errors never fail a hook or the status line; no Claude trailers in commits.
**Verification:** `npm test && npm run typecheck` in each repo.

Verified facts the plan relies on (2026-10-06): Claude Code 2.1.291 hook inputs carry no usage; a subagent transcript (`agent_transcript_path`) has `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` and repeats a message; the status-line stdin has `cost.total_cost_usd`, `context_window.used_percentage`, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`, `workspace.current_dir`; pi-subagents 0.76.1 `SingleResult` has `usage.{input, output, cacheRead, cacheWrite}` and `model`.

### Review focus
1. A session snapshot written at every Stop must replace, not add to, the previous one of that session.
2. A subagent transcript that repeats a message id counts it once.
3. The status line with no ledger, no `rate_limits`, or garbage stdin.
4. An existing user `statusLine` that isn't ours is never overwritten without `--force`.
5. Ledger growth: the status line reads it on every message; it must stay one file read.

### Post-implementation
- README (both): a "Token usage" section — status line install command, what it shows, `usage-log`.
- `docs/ARCHITECTURE.md` + `.ru.md` (both): the ledger and where it lives.
- CHANGELOG 0.22.0 (both); versions 0.22.0 (eng-kit `package.json`, `.claude-plugin/plugin.json`; pi `package.json`).
- private `docs/FRAMEWORK-SOURCES.ru.md` §11.28.
- finish skill (Claude) and `prompts/finish.md` (pi): print the branch summary.

### Task 1: ledger and transcript reader (`lib/usage.ts`)
**Files:** Create `lib/usage.ts` · Test `tests/usage.test.ts`
**Interfaces:** Produces `type Tokens = { input: number; output: number; cacheWrite: number; cacheRead: number }`; `readTranscriptUsage(path: string): { model: string; tokens: Tokens }[]`; `appendUsage(projectDir: string, record: UsageRecord, root?: string): void`; `branchSummary(projectDir: string, branch: string, root?: string): { byAgent: Record<string, number>; subagents: number; total: number }`; `formatTokens(n: number): string`.
`UsageRecord = { kind: "subagent"; id: string; agent: string; model: string; tokens: Tokens; branch: string; at: number } | { kind: "session"; id: string; tokens: Tokens; branch: string; at: number }`. Ledger: `join(reviewsDir(projectDir, root ?? <tmpdir>/eng-kit/usage), "ledger.jsonl")`.
- [x] Tests: `readTranscriptUsage` on a fixture with a repeated message id sums it once (criterion 2); an unreadable path and a corrupt line give `[]`/skip (criterion 7); two `session` records with one id count only the later, two ids add up, `subagent` records add by agent (criterion 3); `formatTokens` 950 → "950", 12_345 → "12k", 1_234_567 → "1.2M"
- [x] Run `npm test -- tests/usage.test.ts` → FAIL on the assertions (stubs return empty)
- [x] Implement; total tokens = input + output + cacheWrite + cacheRead
- [x] Run → PASS, full suite; commit `feat(usage): per-branch token ledger and transcript reader`

### Task 2: Claude hooks fill the ledger
**Files:** Modify `lib/hooks.ts` (`HookEnv.usageRoot?`), `tests/hooks.test.ts`
- [x] Test: a SubagentStop for any agent type with a fixture `agent_transcript_path` appends one `subagent` record (agent type, model, tokens, current branch); a Stop with a fixture `transcript_path` appends a `session` snapshot; both in a try so a missing transcript changes nothing else (reviewer verdict path unchanged)
- [x] Run → FAIL; implement at the top of `subagentStop` and `stop` (before `stop_hook_active` returns); run → PASS, full suite
- [x] Commit `feat(usage): record subagent runs and session snapshots from hooks`

### Task 3: status line
**Files:** Create `lib/statusline.ts`, `scripts/statusline.ts` · Test `tests/statusline.test.ts`
**Interfaces:** `statusText(input: unknown, sub: number | undefined, color: boolean): string`; `bar(pct: number): string` (10 cells, `▓` per started 10 %, rest `░`)
- [x] Tests (criteria 1, 1a, 7): full input → `ctx ▓▓▓▓▓░░░░░ 42% · $1.87 · 5h ▓▓▓▓▓▓▓░░░ 63% ↻14:20 · 7d ▓▓▓▓░░░░░░ 31% · sub 1.2M` without colour; no `rate_limits` → no 5h/7d parts; `sub` undefined → no sub part; garbage → `eng-kit`; colour rows at 0/49 → green (32), 50/79 → yellow (33), 80/100 → red (31); `color=false` (from `NO_COLOR`) → no `\x1b[`
- [x] Run → FAIL; implement; `resets_at` shown as local `HH:MM`; the script reads stdin, finds the branch of `workspace.current_dir`, reads the ledger once, prints one line, exits 0 on any error
- [x] Run → PASS; commit `feat(usage): status line with bars and colours`

### Task 4: status-line installer
**Files:** Modify `lib/statusline.ts` · Create `scripts/statusline-install.ts` · Test `tests/statusline.test.ts`
**Interfaces:** `planStatusLine(settings: string | undefined, command: string, force: boolean): { status: "added" | "same" | "replaced" | "refused" | "invalid"; text?: string }`; `stableRoot(kitRoot: string, home: string): string` (`…/plugins/cache/<market>/<plugin>/<ver>` → `~/.claude/plugins/marketplaces/<market>` when it exists, else `kitRoot`)
- [x] Tests (criterion 5): no file → added; ours → same; someone else's → refused, with `force` → replaced (other keys kept); invalid JSON → invalid, untouched; `stableRoot` maps a cache path and keeps a project path
- [x] Run → FAIL; implement; the script prints the planned change and writes `~/.claude/settings.json` only on added/replaced
- [x] Run → PASS; commit `feat(usage): status-line installer for user settings`

### Task 5: branch summary
**Files:** Create `scripts/usage-log.ts` · Modify `skills/finish/SKILL.md`, `lib/usage.ts` (`summaryLine`) · Test `tests/usage.test.ts`
- [x] Test (criterion 4): `summaryLine({ byAgent: { main: 3.4e6, reviewer: 2.1e6, implementer: 8e5 } … })` → `main 3.4M · reviewer 2.1M · implementer 800k · total 6.3M`, agents by size
- [x] Run → FAIL; implement; the script prints the current (or named) branch; finish skill: one sentence to run it after verification and include the line in the summary
- [x] Run → PASS (lint-skills too); commit `feat(usage): branch token summary in /finish`

### Task 6: pi edition
**Files:** Copy `lib/usage.ts` → `src/extensions/lib/usage.ts`, `scripts/usage-log.ts`; Modify `src/extensions/guard.ts`, `src/prompts/finish.md`; Tests `src/tests/usage.test.ts` (same as Task 1, path-adjusted), `src/tests/guard*.test.ts`
- [ ] Test (criterion 6): a `subagent` tool_result with `usage` and `model` appends a record per run; `agent_end` appends a session snapshot from the branch's assistant messages; the status text is `sub 1.2M · branch 5.6M`
- [ ] Run → FAIL; implement (`ctx.ui.setStatus("eng-kit", …)` only with a UI); run → PASS; `cmp` the two `usage.ts`
- [ ] Commit `feat(usage): pi ledger and status text`

### Task 7: docs and release
- [ ] Post-implementation docs and versions in both repos; full verification; commit `chore: release 0.22.0`

## Progress

Baseline: 642d993, npm test 397 pass, typecheck clean.
Task 1: complete (642d993..e1bbc29, npm test → 400 pass; usage tests seen failing on assertions first)
Task 2: complete (ed742b9..16e8973, npm test → 401 pass; ledger hook test seen failing on assertion first)
Task 3: complete (b2211f8..12c1b71, npm test → 403 pass; statusline tests seen failing first; script tried by hand: coloured line, garbage → eng-kit, exit 0)
Task 4: complete (9b3f41f..f52a243, npm test → 405 pass; installer tests seen failing first; script tried on a temp CLAUDE_CONFIG_DIR: dry-run, add, same)
Task 5: complete (c8556ae..ee6c424, npm test → 406 pass incl. lint-skills; summary test seen failing first)
