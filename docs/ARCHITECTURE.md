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
│   SubagentStop      review stamp from the reviewer report             │
│   Stop              verify, approval, working-docs gates              │
│   UserPromptSubmit  re-arms the gates                                 │
│ skills/   34 skills: 28 methodology + 6 entry points                  │
│ agents/   reviewer (opus, read-only), implementer (sonnet)            │
│ scripts/  verify.ts, init.ts, install-project.ts                      │
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
| `SubagentStop` (review gate) | When the `reviewer` agent finishes (`eng-kit:reviewer` in the plugin), the hook takes the `Reviewed HEAD: <sha>` and `Ready to merge: …` lines from `last_assistant_message` and writes a `{sha, verdict}` stamp to `<tmpdir>/eng-kit/reviews/<sha1(project)>.json`. Reviewers of one prompt are merged into the worst verdict | The stamp is written by the hook from the reviewer's own report, not by the main agent. The `agent_type` and `last_assistant_message` fields are verified by a live run (claude 2.1.285) |
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
| the same without a reviewer `Yes` verdict for the commit being landed (review gate) | editing `.claude/guard.json` |
| `git commit` on the base branch with a staged task file; writing into review stamp files | |

Pushing the work branch itself is allowed (it still asks, like any push).

`.claude/guard.json`: `block`, `confirm`, `allow` (regex), `protectedPaths`, `workDocs` (the task-file folders, default `["docs/tasks"]`; `[]` turns the rule off) and `reviewGate` (`false` turns the review gate off). `allow` only removes a question and never removes a block. A separate trust check isn't needed: Claude Code applies project hooks and settings only after the user trusts the folder.

In addition, `kit-init` adds native deny rules `Read(**/.env)`, `Read(**/*.pem)` and so on to `.claude/settings.json`. This is defense in depth: they work even if hooks are disabled.

---

## Review and after push

**Review** (`requesting-code-review`, the `reviewer` agent):
- **fixed severity** from the table in the checklist. Critical: secrets, injections and authZ, loss of money or data, weakened tests, stub code, type or linter errors suppressed without a reason. Important: a criterion without a test, stale docs, a broken project rule (CLAUDE.md, `.claude/rules/`, decision records), an unmarked breaking change, a function longer than ~100 lines or a file longer than ~1000 lines;
- **rules against persuasion:** "it's like this everywhere in the project" is debt, not permission; severity isn't lowered under pressure from arguments; what's judged is the changed lines and what they break;
- **rule changes in the diff itself:** if a diff changes the rules (agent manifest, linter config, standards), it is judged by the base branch's rules;
- **repeat round:** only what's new since the last review is checked, and every earlier finding is re-checked;
- **project rules with a quote:** a finding against a rule names it (file with a heading, anchor or ID) and gives a short quote;
- **don't duplicate CI:** what the verify commands and linters check (format, lint, types) the reviewer doesn't repeat, unless the check fails or is missing. Verbose text is at most one grouped Minor;
- **repeat round by defect:** findings are matched by the substance of the defect, not by wording; the same defect in other words is not a new finding;
- **several reviewers** (payments, auth, migrations) are merged by root cause; on one `file:line` the higher severity stays, the overall verdict is the worst;
- **verdict** `Yes / With fixes / No / Inconclusive` and a `Reviewed HEAD: <sha>` line. Inconclusive means the reviewer couldn't read the requirements, the range or the rules;
- **no noise:** no praise and no made-up references.

**Review gate** (mechanics, not an instruction). The guard denies `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to it unless the reviewer's last verdict for that commit is `Yes`. The stamp is written by the `SubagentStop` hook. A commit after the review that changes anything besides task files and ignored paths (`ignore` from verify.json, default docs) needs a new review; deleting a task file doesn't. A branch with only ignored paths needs no review. `With fixes`, `No` and `Inconclusive` don't pass: fix and review the new range. A finding the author declined without a code change is cleared by a repeat review in the next prompt, after the user has seen the arguments. Only the user turns the gate off: `"reviewGate": false` in `.claude/guard.json`; the guard asks the user to confirm edits to that file and denies writing into the stamp files. It protects against a forgotten or skipped review, not against an agent that deliberately feeds the reviewer a ready answer.

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
  - one required `gate`;
  - by stack and only with your "yes": test hygiene, e2e without retries with a count of tests run, secret scanning and dependency audit, migrations and schema drift, contracts, coverage as a floor on a schedule.
- **Linking the layers:**
  - `kit-init` mechanically checks that CI runs every verify command and has the working-docs job;
  - review counts a command missing from CI, a weakened check and a broken project rule as Important.
- **BDD** is an optional acceptance layer (`test-driven-development/references/bdd.md`). Each user-visible criterion of the task file is one scenario tagged with the criterion. The result is a chain "criterion → scenario → CI".

---

## Testing

The foundation is the iron rule of TDD: a failing test first, then minimal code, then a run of the whole suite. Everything else is collected in the standard `test-driven-development/references/test-standard.md`:
- **expected values** come from the task file's criterion, not from the code's output; characterization tests are marked separately;
- **a test must pay for itself:** no tests of constants, config, schema shape, "it renders", echoing a mock; identical cases are merged into a parameterized test;
- **structure and names:** Arrange–Act–Assert, one behavior per test, name = subject + circumstance + result;
- **mocks:** only unmanaged dependencies are faked; your own DB and queues are real in integration tests;
- **determinism and flakiness:** time and randomness under control, no network, a run outside UTC; a retry doesn't count as a fix;
- **acceptance level:** each task criterion → a test that shows it the way the user sees it (API, UI/e2e, BDD if the project has it);
- **coverage** is a floor, not a goal.

The plan names an acceptance test for each criterion. The reviewer checks these rules against the checklist. The standard suggests mechanical lint rules for tests to the project but doesn't impose them.

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
  - guard (block, ask, allow, config, paths, temp, working documents, review gate: stamp, verdict merging, code after review, deleting a task file);
  - the command parser and the evidence rule;
  - hook handlers (SessionStart, PreToolUse for Bash, PowerShell, Read, Grep, Edit, NotebookEdit; the tracker and the Stop gates);
  - `hook.ts` over stdin/stdout, including a crash;
  - `verify.ts`;
  - `kit-init`;
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

---

## 10. How to extend it

- A new skill is written with `writing-skills`: first a scenario without the skill (RED), then a minimal skill. Then `npm test`, `claude plugin validate .` and a line in this document.
- A rule that can be checked mechanically lives in a hook, in `permissions` in settings.json or in CI, not in a skill's text.
- Domain plugins for a specific company (a specific acquirer, fiscal data operator) are better made as a separate plugin and connected through `dependencies` in `plugin.json`.
