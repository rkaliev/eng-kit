# Token usage in the terminal: status line and per-branch ledger

Status: design approved (2026-10-06)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: <set by writing-plans>
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
| 1 | Claude: the status line prints one line `ctx ▓▓▓▓░░░░░░ 42% · $1.87 · 5h ▓▓▓▓▓▓░░░░ 63% ↻14:20 · 7d ▓▓▓░░░░░░░ 31% · sub 1.2M` from the JSON Claude Code passes it; a missing field is left out (API users have no `rate_limits`), and malformed input prints a short fallback instead of failing | unit: statusline formatter rows for full input, no rate limits, no ledger, malformed JSON |
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
- Does pi's `subagent` tool result carry usage? → first plan task verifies it on pi-subagents; if not, pi shows only the branch total of the main session.
- Status-line cost: it runs on every assistant message → reading the ledger must stay cheap (one file, tail only).

## Follow-ups

- Odd backtick in an unquoted heredoc body over-refuses (guard, 0.21.2 follow-up).
- Duplicated `decision()` tail in the hidden + visible landing message (0.21.2 follow-up).

## Plan

None yet

## Progress

None yet
