# eng-kit: how it works

Russian version: [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md)

eng-kit is a plugin for [Claude Code](https://code.claude.com) that turns the agent into a disciplined engineer. The plugin fits any project and adapts to it along three independent axes:
- **where the code runs:** web, mobile apps (Android, iOS), desktop (Windows, Linux);
- **what it does:** from entertainment apps to point-of-sale systems and payments; where a mistake is costly (money, fiscal rules, security), there are dedicated skills;
- **what state the code is in:** a new project or an existing one, including one written long before agentic development.

The same process runs on top of these axes: design → plan → TDD → verify → review → git.

This document describes how the plugin works and why it works that way. What plugins are, and how to install and try eng-kit: [GETTING-STARTED.md](GETTING-STARTED.md).

---

## 1. The idea in four sentences

1. **The process scales with the size of the task.** A small change takes the short path, an architectural one takes the full path from a task file to review. When in doubt, choose the heavier path. Risk sets the floor: CI and release pipelines, permissions, auth, secrets, money, schema and deploy config never take the short path, however small the change.
2. **The model doesn't decide by itself that the work is done.** The project's checks decide: the Stop hook sends the agent back to work if there was no green run after the edits.
3. **Anything irreversible or outward-facing goes through a human.** The PreToolUse hook (guard) blocks dangerous commands and asks for confirmation on push, deploy, migrations and publishing.
4. **Task files stay on the work branch.** A task file (description, plan and progress of one piece of work) never reaches the base branch: what lasts moves into `docs/`, and the guard blocks a PR or merge while it exists.

---

## 2. Architecture

```
┌─────────────────────────────── project ───────────────────────────────┐
│ CLAUDE.md (or @AGENTS.md)   .claude/verify.json   .claude/guard.json  │
│ .claude/settings.json (deny for secrets, plugin pin for the team)     │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ read
┌──────────────────────── eng-kit (this plugin) ────────────────────────┐
│ hooks/hooks.json → hooks/hook.ts → lib/hooks.ts                       │
│   SessionStart      bootstrap: using-skills rules into context        │
│   PreToolUse        guard: deny / ask / no opinion                    │
│   PostToolUse(+Failure)  tracker: edit → "unverified"                 │
│   SubagentStop      review verdict from the reviewer report           │
│   Stop              verify, approval, working-docs gates              │
│   UserPromptSubmit  re-arms the gates                                 │
│ skills/   34 skills: 28 methodology + 6 entry points                  │
│ agents/   reviewer (opus, read-only), implementer (sonnet)            │
│ scripts/  verify.ts, init.ts, install-project.ts, test-hygiene.ts     │
│ templates/ CLAUDE.md, task.md, verify.json, guard.json, …             │
└───────────────────────────────────────────────────────────────────────┘
```

**The working loop:**

```
idea ──/brainstorming──▶ classification: Spike | Bounded | Architectural
  Spike ─────────▶ probe → recommendation (throwaway code)
  Bounded ───────▶ design in chat → "yes" → /implement (TDD) → verify → report
  Architectural ─▶ task file → "yes" → /writing-plans → "yes" → /implement (executing-plans)
                    → reviewer agent → move what lasts to docs/, delete the task file
                    → /finish (merge / PR / keep / discard)
bug ──/systematic-debugging──▶ root cause → failing test → one fix → verify
someone else's repo ──/onboarding-existing-codebase──▶ map → proven commands → CLAUDE.md + .claude/verify.json
```

**Who is responsible for what:**
- **Skills** hold all of the methodology.
- **Entry points** (`implement`, `finish`, `new-task`, `verify`, `kit-init`) are thin wrappers. The model doesn't call them by itself (`disable-model-invocation: true`).
- **Agents** provide a fresh context for review and for executing a plan task.
- **Hooks** mechanically enforce what can't be left to text alone.

---

**The task file** `docs/tasks/YYYY-MM-DD-<slug>.md` is written from the `templates/task.md` template and stands in for a tracker issue: the description on top, the plan and progress appended below it:
- Status / Base / Links, the original request verbatim, then Intent / Context / Success criteria / Scope / Decisions / Design / Rollout / Risks / Follow-ups, then Plan and Progress;
- each has an exact heading and one question; an empty section is marked "None";
- status: draft → design approved (brainstorming, your "yes") → plan approved (writing-plans fills `## Plan`, your "yes") → in progress. Bounded work stays in chat, with no file.

Before asking questions, the agent builds a **context map** (`brainstorming/references/context-map.md`): tickets, old plans and docs count as hypotheses to check against the code. Then it writes down the intent, assumptions and open questions. The task file has a `Base:` with a commit SHA; during execution the agent checks whether the code has drifted and keeps its log in `## Progress`. A PR has a description format, and one topic per PR.

---

## 3. Hooks: mechanics that can't be left to text

One file, `hooks/hook.ts`, handles all events. It reads JSON from stdin, and the logic lives in `lib/hooks.ts` as pure functions, so it is easy to test.

| Event | What it does | Why |
|---|---|---|
| `SessionStart` (`startup\|resume\|clear\|compact`) | Puts the body of the `using-skills` skill and the paths to the kit scripts ("Kit root", "Kit verify script") into the context | Without this, skills are inert: the model sees only their descriptions. The `compact` matcher brings the rules back after compaction. Skills use the paths from the context to find the scripts in both install modes |
| `PreToolUse` | Guard: `permissionDecision: "deny"` or `"ask"`. It has no opinion on other calls | `ask` shows the native permission dialog; in `-p` without a UI such a call is denied. The guard never grants "allow", so Claude Code's own permission rules keep applying |
| `PostToolUse` / `PostToolUseFailure` | Tracker: after Edit/Write/MultiEdit/NotebookEdit the workspace is "unverified". An exact, unpiped run of a verify command marks it green; a non-zero exit code marks it red | Hooks are separate processes, so the state is kept in a file per `session_id` in `${CLAUDE_PLUGIN_DATA}` (in folder mode, in the temp directory) |
| `SubagentStop` (review gate) | When the kit's reviewer finishes (`agent_type` `reviewer` or `eng-kit:reviewer`; other plugins' reviewers don't count), the hook takes the `Reviewed HEAD: <sha>` and `Ready to merge: …` lines from `last_assistant_message` and writes a verdict record, one file per reviewer run and commit, to `<tmpdir>/eng-kit/reviews/<sha1(project)>/`. Records older than 30 days are pruned; the folder is trusted only if it belongs to the current user. Reviewers of one prompt are merged into the worst verdict. A report without the two lines gets `{"decision":"block"}` once (never when `stop_hook_active`), so the reviewer adds them | The record is written by the hook from the reviewer's own report, not by the main agent. One file per run and commit: parallel reviewers don't overwrite each other, and reviewing another branch doesn't forget this one. The `agent_type` and `last_assistant_message` fields and the send-back are verified by a live run (claude 2.1.285) |
| `Stop` | If the workspace is unverified: `{"decision":"block","reason":…}`, once per prompt, and never when `stop_hook_active` | The model doesn't decide by itself that the work is done. One reminder per prompt keeps the gate from looping |
| `Stop` (approval gate) | If a task file in `docs/tasks` with `Status: design approved` or `plan approved` is uncommitted: `block` with the list of files, once per prompt. On the base branch it says to create a work branch first | An approval that isn't in git can get lost or change unnoticed. The skill asks for this, but the model can skip text, and a hook can't be skipped |
| `Stop` (working-docs gate) | If a task file has every box in its Plan section ticked: `block` with the list of files, once per prompt, asking to move what lasts into `docs/` and `docs/decisions/`, show the Follow-ups and delete it | An implemented task file left in the tree becomes a stale second source of truth |
| `UserPromptSubmit` | Re-arms all three gates for the new prompt | — |

`scripts/verify.ts` runs the commands from `.claude/verify.json` (otherwise from `## Commands` in CLAUDE.md or AGENTS.md) and exits with code 0 only if everything is green. The tracker counts such a run as full evidence.

If a hook crashes (for example, on an old Node), it exits with code 1. For Claude Code that is a non-blocking error: the guard is defense in depth, and a broken hook must not stop work.

## 4. Two install modes, one source

- **Plugin** (recommended): the `eng-kit:` namespace, versioned updates through the marketplace. For a team, a pin in `.claude/settings.json` is enough (`claude plugin install … --scope project`).
- **`.claude/` folder**: `scripts/install-project.ts` copies skills into `.claude/skills/`, agents into `.claude/agents/`, hook code into `.claude/eng-kit/`. Hooks are registered in `.claude/settings.json` from the same `hooks/hooks.json`: `${CLAUDE_PLUGIN_ROOT}` is replaced with `$CLAUDE_PROJECT_DIR/.claude/eng-kit`. The manifest `.claude/eng-kit/manifest.json` remembers which files the kit wrote, so a re-run updates them and leaves project files alone.

The hook code is the same in both modes. The kit root is the parent folder of `hooks/`, and bootstrap looks for skills in both `<root>/skills` and `<root>/../skills`.

---

## 5. Skills

**Process core:** using-skills, brainstorming, writing-plans, executing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, git-workflow, dispatching-parallel-agents, ci-quality-gates, writing-documentation, updating-dependencies, writing-skills.

**Starting point: new or existing code:** choosing-a-stack, onboarding-existing-codebase, changing-legacy-code.

**Platforms:** web-frontend, backend-services, mobile-development (Android and iOS in `references/`), desktop-development (Windows and Linux in `references/`), ui-motion (animation and gestures on every platform: whether to animate at all, then easing, budgets, interruptibility, reduced motion; values and per-platform APIs in `references/`). web-frontend keeps state and optimistic updates, and the design system with destructive-action copy, in `references/`; mobile and desktop point to them.

**High-risk domains:** payments-and-money, pos-systems, security-review, observability, database-changes.

**Context cost.** Only skill descriptions go into every session. A skill's body loads when the task matches it, and `references/` only when details are needed. So two new skills add about 60 tokens, not their 1.3k words.

**Documentation** rests on four layers:
1. the rule in `writing-documentation`: docs in the same change and about the current state;
2. the "Post-implementation" block in every plan and the docs update step in `/implement` and `executing-plans`, plus a Docs line in the final report;
3. in review, stale docs are Important, not Minor;
4. mechanical checks (links, markdownlint, doc-comment linters, API reference generation): `writing-documentation/references/checks.md` suggests adding them to the project's verify and CI.

**Two kinds of documents.**
- **Working** documents: the task file (`docs/tasks/`) and the legacy map. The task file is filled as work goes on (`brainstorming` writes the description, `writing-plans` the Plan, `executing-plans` the Progress) and records intent and progress. It lives only on the work branch.
- **System** documents: README, `docs/NN-topic.md` chapters with the `docs/README.md` index, decision records in `docs/decisions/`, CHANGELOG. They describe what exists now. `/docs` creates them, and the Post-implementation block and the docs step during plan execution keep them current.

At the end of plan execution, what lasts moves out of the task file: behavior into the chapter about that feature, decisions and lasting rulings into `docs/decisions/`. The user sees its Follow-ups, then the file is deleted in one commit (`docs: remove the task file for <feature>`); git keeps it, and the PR body links it at the last commit that had it. A replaced task file is deleted too. There is no roadmap: several independent subsystems become separate tasks, one now and the rest one line each in `## Follow-ups`, and each later one gets its own task file, branch and PR. Work is split only at real seams, never by size: each task delivers value or a rollout step and is green on its own.

**Decision records** are living documents: `docs/decisions/NNNN-slug.md`, one topic per file, a stable number for citations. When a decision changes, its record is rewritten in place; when it no longer applies, the record is deleted. There is no status, date or changelog; the sections are Decision, Why, Consequences, Considered and rejected. Every document keeps only its current version, so the context stays small and consistent.

**Context for the agent.** The project's CLAUDE.md (from `templates/CLAUDE.md`) has a Docs section: the index (`docs/README.md`, `llms.txt` if any), a "Task → Start with" table, and which source wins: code, tests and CI say what exists, decision records say which rules hold and why, topic docs describe; a contradiction is a bug to report. Guidance lines in the template are HTML comments, which Claude Code strips from the context. Rules for one area go into `.claude/rules/*.md` with `paths:` frontmatter and load only for matching files; a nested CLAUDE.md per package loads when work reads files there. Personal notes go into the agent's memory, not the repo.

**Entry points (manual only):** `/implement`, `/finish`, `/new-task`, `/verify`, `/kit-init`, `/docs`. In plugin mode their names start with `/eng-kit:`.

Entry points are thin wrappers. The other skills can also be called as `/name`, so they don't need separate wrappers. The names `plan`, `review` and `debug` aren't used because Claude Code's built-in commands take them.

## 6. Agents

| Agent | Model | Tools | Why |
|---|---|---|---|
| `reviewer` | opus, effort high | Read, Grep, Glob, Bash. Edits are forbidden through `disallowedTools` | The final review is the main quality decision, and it's worth spending on. A fresh context sees what the author's context hides. It reads the project's rules (CLAUDE.md or AGENTS.md, matching `.claude/rules/`, decision records the diff touches or cites). The report ends with the `Reviewed HEAD:` and `Ready to merge:` lines, which the review gate reads |
| `implementer` | sonnet | all | One plan task with TDD. Status DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. The report is checked, not taken on trust |

Claude Code ignores the `hooks`, `mcpServers` and `permissionMode` fields for plugin agents, so they aren't used. The linter checks this. The model is overridden through `CLAUDE_CODE_SUBAGENT_MODEL` or at call time.

---

## 7. Guard: what it does

| Blocks (deny) | Asks (ask; denied in `-p`) |
|---|---|
| `--no-verify`, `git commit -n` | `git push`, publishing and releases |
| `push --force` / `-f` / `+ref` / `--mirror` | deploys, `terraform apply`, `kubectl apply`, `helm upgrade` |
| recursive `rm` outside the project and temp | DB migrations, `DROP` / `TRUNCATE` |
| reading `.env*` (except `.example` and similar), keys, keystores, credentials (Read, Grep) | `git reset --hard`, `git clean -f`, `branch -D`, `sudo`, `curl … \| sh` |
| writing into `.git/` and `protectedPaths` | shell access to secret files, writing a secret file |
| `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to the base while a task file is tracked | editing CI and release pipelines (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile` and similar) |
| the same without a reviewer `Yes` verdict for the commit being landed, or chained after anything but read-only steps and the project's verification commands (review gate) | editing `.claude/guard.json` (Edit/Write, or a non-read-only shell command naming it) |
| `git commit` on the base branch with a staged task file; writing into the review records (Edit/Write, or a shell command naming their path) | `gh pr merge <number\|URL>`: the PR head isn't known locally (review gate) |

Pushing the work branch itself is allowed (it still asks, like any push).

`.claude/guard.json`: `block`, `confirm`, `allow` (regex), `protectedPaths`, `workDocs` (the task-file folders, default `["docs/tasks"]`; `[]` turns the rule off) and `reviewGate` (`false` turns the review gate off). `allow` only removes a question and never removes a block. A separate trust check isn't needed: Claude Code applies project hooks and settings only after the user trusts the folder.

In addition, `kit-init` adds native deny rules `Read(**/.env)`, `Read(**/*.pem)` and so on to `.claude/settings.json`. This is defense in depth: they work even if hooks are disabled.

---

## Review and after push

**Review** (`requesting-code-review`, the `reviewer` agent):
- **fixed severity** from the table in the checklist. Critical: secrets, injections and authZ, loss of money or data, a test weakened, skipped or changed in a way test-standard's "Changing tests" doesn't allow, a committed focused test, a CI check removed, skipped or retried, retries in a runner config, stub code, type or linter errors suppressed without a reason. Important: a criterion without a test or with a manual check that isn't necessary or agreed, a plan's Review focus line without a test, a test without an assertion or asserting mock echo, an expected value copied from the code or recomputed with its algorithm, a test-only helper in production code, a fixed sleep or a real network call outside the sandbox suite, payments without a sandbox test, POS without a list of what ran on real hardware, stale docs, a broken project rule (CLAUDE.md, `.claude/rules/`, decision records), an unmarked breaking change, a function longer than ~100 lines or a file longer than ~1000 lines;
- **only verified code:** a review that ran while edits were unverified (the verify gate wasn't green) is recorded as Inconclusive; checks first, then review;
- **rules against persuasion:** "it's like this everywhere in the project" is debt, not permission; severity isn't lowered under pressure from arguments; what's judged is the changed lines and what they break;
- **rule changes in the diff itself:** if a diff changes the rules (agent manifest, linter config, standards), it is judged by the base branch's rules;
- **repeat round:** only what's new since the last review is checked, and every earlier finding is re-checked;
- **project rules with a quote:** a finding against a rule names it (file with a heading, anchor or ID) and gives a short quote;
- **don't duplicate CI:** what the verify commands and linters check (format, lint, types) the reviewer doesn't repeat, unless the check fails or is missing. Verbose text is at most one grouped Minor;
- **repeat round by defect:** findings are matched by the substance of the defect, not by wording; the same defect in other words is not a new finding;
- **several reviewers** (payments, auth, migrations) are merged by root cause; on one `file:line` the higher severity stays, the overall verdict is the worst;
- **verdict** `Ready to merge: <exactly one of Yes, No, With fixes, Inconclusive>` and a `Reviewed HEAD: <sha>` line; an echoed template (`Yes / No / …`) is not a verdict. Inconclusive means the reviewer couldn't read the requirements, the range or the rules;
- **no noise:** no praise and no made-up references.

**Review gate** (mechanics, not an instruction). The guard denies `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to it unless the reviewer's last verdict for that commit is `Yes`. The verdict record is written by the `SubagentStop` hook; a review that ran while the session's edits were unverified (in a project with verification commands) is recorded as `Inconclusive`. A review covers the branch's own change to reviewable files compared with the remote base (`origin/<base>`), matched by its diff with one line of context but without line numbers (binaries by content): deleting task files, changing docs or rebasing onto a newer base keeps it valid; any other change, whitespace and binaries included, needs a new review. Exempt are task files (`docs/tasks/`), prose and pictures in `docs/` and other `*.md`/`*.mdx`, except markdown that steers the agent: CLAUDE.md, AGENTS.md, SKILL.md and anything under `.claude/`, `rules/`, `skills/`, `agents/`, `prompts/`. The list is fixed; the project can't widen it. A branch with only exempt files needs no review. `cd <dir>` and `git -C <dir>` are followed from the session cwd, so a worktree's branch is checked where the command runs. A landing chained after anything but read-only steps and the project's verification commands (`git commit … && gh pr create`, `git switch main && git merge …`) is denied: the guard can't see what it lands. `gh pr merge <number|URL>` asks, because the PR head isn't known locally; `gh pr merge <branch>` and `gh pr create --head <branch>` check that branch. `With fixes`, `No` and `Inconclusive` don't pass: fix and review the new range. A finding the author declined without a code change is cleared by a repeat review in the next prompt, after the user has seen the arguments. Only the user turns the gate off: `"reviewGate": false` in `.claude/guard.json`; the guard asks before that file is changed (Edit/Write or shell) and denies writes to the review records. It protects against a forgotten or skipped review, not against an agent that deliberately feeds the reviewer a ready answer.

**Responding to review** (`receiving-code-review`): every comment is either fixed or answered; none is skipped silently. You can't write "resolved" while a blocker is open or until a repeat review has closed the finding.

**People in the chain** (`ci-quality-gates`, only with your "yes"): one required human approval (AI review complements it but doesn't replace it) and CODEOWNERS on the files that govern the rest: the agent manifest and its folder, path rules, CI, `docs/decisions/`, linter and type configs.

**After push** (`git-workflow`):
- CI is watched with the hosting tool, not a hand-written loop;
- for each failed check, at most two attempts with a found cause, then a question to you;
- the agent never merges by itself;
- rebasing your own branch: only `--force-with-lease=<branch>:<sha>`.

**Processes:** dev servers and watchers run in the background; the agent stops only what it started itself.

---

## Two layers of checks: session and CI

- **The agent session.** TDD, the verify gate after every edit, the approval and working-docs gates, the guard, review. Catches a problem right away, while the agent is working.
- **The project's CI** (`ci-quality-gates`). Runs on every change, whoever made it, and doesn't depend on hooks or the model:
  - at minimum, everything from `verify.json`;
  - the `working-docs` job, which fails on any tracked `docs/tasks/*.md`, so task files don't reach the base branch from any author;
  - one required `gate` (it lists `e2e` only if the project has that job);
  - by stack and only with your "yes": test hygiene, e2e without retries whose JUnit reports are checked with `--junit test-results/` (reports only), provider sandboxes as a separate job, secret scanning and dependency audit, migrations and schema drift, contracts, coverage as a floor on a schedule.
- **The `test-hygiene` script** (`scripts/test-hygiene.ts`): one dependency-free file that needs only Node ≥22.18, whatever the project's stack. `kit-init` offers it and copies it into `.ci/test-hygiene.mts` (an ES module whatever the project's `package.json` says) only with `--test-hygiene` (`node <kit>/scripts/init.ts --test-hygiene`), after your "yes". The same flag replaces an older copy (versions compared numerically), and the CI gap is reported in the same run. The `test-hygiene` and `e2e` jobs from the ci-quality-gates templates run it. It checks:
  - focused tests and skips without a linked issue (`#123`, a URL or `ABC-123`; a reason in words is not enough) in JS/TS (Playwright `test.describe.only/skip/fixme`, Cypress, Mocha and Nest layouts), Python, JVM, Go, Swift, .NET, Gherkin; fixed sleeps; retries in runner configs and in test code (`this.retries`, `describe.configure`, pytest `flaky`);
  - criterion tags (`@C<n>`) on the tag lines the branch adds or changes, against the criteria table of the task file in the branch: a criterion without a scenario, two scenarios for one criterion, a tag without a criterion. Tags of finished tasks never fail a run; `--all` skips the tag check;
  - `--junit <dir>` alone checks only the reports: missing or empty, or a declared count that differs from the cases that ran (a crashed shard).

  In an existing project it is a ratchet: only lines the change adds count (renames are followed), and pre-existing debt is counted in the summary, not blocking (`--all` checks every line). Without a merge base it stops with a message: CI needs `fetch-depth: 0` and, on GitLab, an explicit fetch of the target branch. `test-hygiene: allow <reason>` marks a line where the pattern is the behavior under test; an allow without a reason is itself reported, and one that hides a forbidden skip, retry or sleep needs your agreement. `.claude/test-hygiene.json` adds test files, ignores and patterns. Next to it go the stack's native linters (table in `ci-quality-gates/references/ci-templates.md`).
- **Linking the layers:**
  - `kit-init` mechanically checks that CI runs every verify command, has the working-docs job and runs `.ci/test-hygiene.mts` when the project has it, and reports a copy older than the kit's;
  - review counts a command missing from CI and a broken project rule as Important, and a removed, skipped or retried check as Critical.
- **BDD** is an optional acceptance layer (`test-driven-development/references/bdd.md`). Each user-visible criterion of the task file is exactly one scenario tagged with the criterion. The result is a chain "criterion → scenario → CI", and `test-hygiene` checks the tags.

---

## Testing

The foundation is the iron rule of TDD: a failing test first, then minimal code, then a run of the whole suite. Every other test rule lives in one place, the standard `test-driven-development/references/test-standard.md`; TDD, BDD, writing-plans and the review checklist link to it instead of restating it:
- **expected values** come from the task file's criterion, not from the code's output. The one exception is characterization tests of legacy code: `*.char.test.*` (or the stack's tag), they pass on first run by design and don't count as coverage of new behavior. Golden data in a port is an acceptance test that fails first, not characterization;
- **seen failing first:** every new test, except a characterization test;
- **a test must pay for itself:** no tests of constants, config, schema shape, "it renders", echoing a mock; identical cases are merged into a parameterized test; snapshots are small and inline;
- **structure and names:** Arrange–Act–Assert, one behavior per test, name = subject + circumstance + result; test-only helpers live in test code;
- **mocks:** only unmanaged dependencies are faked; your own DB and queues are real in integration tests. Provider sandboxes are a separate suite and CI job, the only place a test talks to the network;
- **determinism and isolation:** time and randomness under control, no network, a run outside UTC; waits are on a condition with one project-wide ceiling, never a fixed sleep; tests run in any order and in parallel; missing test infrastructure (a database, a container, an emulator) fails the run, never skips it;
- **no retries:** a test never retries, not in the runner config, not in CI, not in a loop. Waiting on a condition (web-first assertions, `expect.poll`, `waitFor`) is not a retry. A flake is fixed only when five criteria hold: the failing run and boundary found, the root cause removed, a repeated run green on the same commit, green in the configuration where it failed, the full suite green;
- **criteria and levels:** with BDD a user-visible criterion has exactly one scenario tagged with it; any other criterion has at least one test at the cheapest level that shows it the way a user or caller sees it; end-to-end without BDD covers critical flows only, one journey each;
- **manual check** replaces a test only where automation is impossible (real hardware, a store review, a fiscal device, a physical signature): the task file gives the reason, you agree, the report says it ran. Elsewhere a criterion without a test is a gap;
- **outside-in with BDD:** the scenario is written first and seen failing, unit TDD cycles drive the code, and the scenario passing closes the criterion. The unit tests underneath test their unit's own contract and stay; only a unit test asserting the user-level outcome the scenario already proves is left out;
- **changing tests:** deleting a test together with its behavior needs only the reason in the commit; editing an assertion, deleting a test whose behavior still exists, or a skip or quarantine needs your agreement and its own commit; a skip names a linked issue (a platform or test-mode skip with an explicit condition and a reason is the one exception). `test-hygiene: allow <reason>` is for a pattern that is the behavior under test; using it to hide a forbidden skip, retry or sleep needs your agreement, and review rates it like the pattern;
- **coverage** is a floor, not a goal; visual baselines are produced only in CI.

The plan names the test for each criterion, and the PR body says how each new test was seen failing first. The reviewer checks the rules with the checklist's fixed severities. The mechanical layer (the `test-hygiene` script and the stack's linters) is added by ci-quality-gates only with your "yes".

---

## 8. Principles built into the plugin

1. Three process paths instead of one heavy one, so small tasks don't drown in bureaucracy.
2. Methodology in skills, mechanics in hooks, thin entry points. The rules for done live in one place.
3. Built-in features aren't duplicated. `Explore` is there for exploration. Models are set through frontmatter (`model:` for agents, `effort: high` for heavy skills); there's no custom routing config. The team pin is the native `--scope project`.
4. No narrow vendor skills. Project specifics go into the project's CLAUDE.md.
5. Confirmation on every `git push`. A narrow `allow` in `.claude/guard.json` lifts it for your own branches, for example `^git push origin feat/`.
6. Skills are in English: triggering is more precise that way. Documentation is in English, with a Russian version of each file (`*.ru.md`).

---

## 9. How it's verified

- **`npm test`**:
  - guard (block, ask, allow, config, paths, temp, working documents, review gate: verdict record, verdict merging, parallel runs, code after review, deleting a task file, remote base, rebase, worktree and `cd`, chained landings, `gh pr merge` by number, shell writes, a review of unverified edits as Inconclusive);
  - the command parser and the evidence rule;
  - hook handlers (SessionStart, PreToolUse for Bash, PowerShell, Read, Grep, Edit, NotebookEdit; the tracker and the Stop gates);
  - `hook.ts` over stdin/stdout, including a crash;
  - `verify.ts`;
  - `test-hygiene.ts` (rules in 7 languages, ratchet with renames, no merge base, JUnit reports only, criterion tags on changed scenarios, config, CLI);
  - `kit-init` (including the test-hygiene item: offered, copied with `--test-hygiene`, an older copy reported and replaced with the flag, a CI that doesn't run it reported in the same run);
  - `install-project` (install, update, conflicts, hooks without duplicates);
  - the skill and agent linter, manifest consistency.
- **`npm run typecheck`** and **`claude plugin validate .`**.
- **A live `claude -p` run** on a copy of `examples/demo`:
  - bootstrap;
  - deny on `git commit --no-verify`;
  - ask and denial on `git push`;
  - the Stop gate after an Edit without tests sent the agent back to `npm test`;
  - folder mode: bootstrap and guard from `.claude/eng-kit`;
  - install through `--scope project` from a local marketplace;
  - review gate (claude 2.1.285, `--plugin-dir`, a copy of `examples/demo` with planted defects): a PR without review was denied; the `reviewer` agent found float rounding of money (Critical, with rule quotes from CLAUDE.md, the task and the checklist) and an uncovered criterion, verdict `No`, denied again; after the fixes the repeat round over the new range re-checked the old findings, `Yes`, and the guard let `gh pr create` through.

**Not verified:** Windows (the PowerShell tool and running the hook through `cmd`), a live run of the `implementer` agent.

**Known limits of the review gate:** an interpreter one-liner can still hide a path from the shell checks; the gate protects against a forgotten review, not against an agent that deliberately feeds the reviewer a verdict; with no resolvable base branch (no `origin/HEAD`, no `main`/`master`) it does nothing.

---

## 10. How to extend it

- A new skill is written with `writing-skills`: first a scenario without the skill (RED), then a minimal skill. Then `npm test`, `claude plugin validate .` and a line in this document.
- A rule that can be checked mechanically lives in a hook, in `permissions` in settings.json or in CI, not in a skill's text.
- Domain plugins for a specific company (a specific acquirer, fiscal data operator) are better made as a separate plugin and connected through `dependencies` in `plugin.json`.
