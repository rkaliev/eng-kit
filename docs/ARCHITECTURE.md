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
3. **Anything irreversible or outward-facing goes through a human.** The PreToolUse hook (guard) blocks dangerous commands and asks for confirmation on deploy, migrations, publishing, merging and any push except a plain push of the agent's own work branch.
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
│ scripts/  verify.ts, init.ts, install-project.ts, test-hygiene.ts, …  │
│ templates/ CLAUDE.md, task.md, verify.json, ts-monorepo/, …           │
└───────────────────────────────────────────────────────────────────────┘
```

**The working loop:**

```
idea ──/brainstorming──▶ classification: Spike | Bounded | Architectural
  Spike ─────────▶ probe → recommendation (throwaway code)
  Bounded ───────▶ design in chat → "yes" → /implement (TDD) → verify → report
  Architectural ─▶ task file → "yes" → /writing-plans → "yes" → /implement (executing-plans)
                    → move what lasts to docs/, delete the task file → verify → reviewer agent
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
| `SessionStart` (`startup\|resume\|clear\|compact`) | Puts the body of the `using-skills` skill and the paths to the kit scripts ("Kit root", "Kit verify script") and the form of the commands the user types ("Kit commands": `/eng-kit:<name>` as a plugin, `/<name>` in a project install) into the context | Without this, skills are inert: the model sees only their descriptions. The `compact` matcher brings the rules back after compaction. Skills use the paths from the context to find the scripts in both install modes |
| `PreToolUse` | Guard: `permissionDecision: "deny"` or `"ask"`. It has no opinion on other calls. Inside the kit reviewer (`agent_type` `reviewer` or `eng-kit:reviewer`) the shell is limited to inspection (review gate) | `ask` shows the native permission dialog; in `-p` without a UI such a call is denied. The guard never grants "allow", so Claude Code's own permission rules keep applying |
| `PostToolUse` / `PostToolUseFailure` | Tracker: after Edit/Write/MultiEdit/NotebookEdit the workspace is "unverified". An exact, unpiped run of a verify command marks it green; a non-zero exit code marks it red. A `gh pr create` or `glab mr create` noted in PreToolUse (by `tool_use_id`, from where the command starts) registers its branch for the review gate when the call succeeds, or fails after the PR step | Hooks are separate processes, so the state is kept in a file per `session_id` in `${CLAUDE_PLUGIN_DATA}` (in folder mode, in the temp directory) |
| `SubagentStop` (review gate) | When the kit's reviewer finishes (`agent_type` `reviewer` or `eng-kit:reviewer`; other plugins' reviewers don't count), the hook takes the `Reviewed BASE: <sha>`, `Reviewed HEAD: <sha>` and `Ready to merge: …` lines from `last_assistant_message` and writes a verdict record with the reviewed range and the report, one file per reviewer run and commit, to `<tmpdir>/eng-kit/reviews/<sha1(the repository's git common directory)>/`. Records older than 30 days are pruned; the folder is trusted only if it belongs to the current user. Reviewers of one prompt are merged into the worst verdict. A report without the three lines gets `{"decision":"block"}` once (never when `stop_hook_active`), so the reviewer adds them | The record is written by the hook from the reviewer's own report, not by the main agent. One file per run and commit: parallel reviewers don't overwrite each other, and reviewing another branch doesn't forget this one. The `agent_type` and `last_assistant_message` fields and the send-back are verified by a live run (claude 2.1.285); `agent_type` in a subagent's PreToolUse by another (claude 2.1.286) |
| `Stop` | If the workspace is unverified: `{"decision":"block","reason":…}`, once per prompt, and never when `stop_hook_active` | The model doesn't decide by itself that the work is done. One reminder per prompt keeps the gate from looping |
| `Stop` (approval gate) | If a task file in `docs/tasks` with `Status: design approved` or `plan approved` is uncommitted: `block` with the list of files, once per prompt. On the base branch it says to create a work branch first | An approval that isn't in git can get lost or change unnoticed. The skill asks for this, but the model can skip text, and a hook can't be skipped |
| `Stop` (working-docs gate) | If a task file has every box in its Plan section ticked: `block` with the list of files, once per prompt, asking to move what lasts into `docs/` and `docs/decisions/`, show the Follow-ups and delete it | An implemented task file left in the tree becomes a stale second source of truth |
| `UserPromptSubmit` | Re-arms all three gates for the new prompt | — |

`scripts/verify.ts` runs the commands from `.claude/verify.json` (otherwise from `## Commands` in CLAUDE.md or AGENTS.md) and exits with code 0 only if everything is green. The tracker counts such a run as full evidence.

If a check throws while handling PreToolUse, the hook answers `ask` with the error instead of letting the call through. In other events it exits with code 1, which Claude Code treats as a non-blocking error: a broken reminder must not stop work. A hook that can't start (an old Node, a broken install) or runs past its timeout is non-blocking too, so the call goes ahead.

## 4. Two install modes, one source

- **Plugin** (recommended): the `eng-kit:` namespace, versioned updates through the marketplace. For a team, a pin in `.claude/settings.json` is enough (`claude plugin install … --scope project`).
- **`.claude/` folder**: `scripts/install-project.ts` copies skills into `.claude/skills/`, agents into `.claude/agents/`, hook code into `.claude/eng-kit/`. Hooks are registered in `.claude/settings.json` from the same `hooks/hooks.json`: `${CLAUDE_PLUGIN_ROOT}` is replaced with `$CLAUDE_PROJECT_DIR/.claude/eng-kit`. The manifest `.claude/eng-kit/manifest.json` remembers which files the kit wrote, so a re-run updates them and leaves project files alone.

The hook code is the same in both modes. The kit root is the parent folder of `hooks/`, and bootstrap looks for skills in both `<root>/skills` and `<root>/../skills`.

---

## 5. Skills

**Process core:** using-skills, brainstorming, writing-plans, executing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, git-workflow, dispatching-parallel-agents, ci-quality-gates, writing-documentation, updating-dependencies, writing-skills.

**Starting point: new or existing code:** choosing-a-stack, onboarding-existing-codebase, changing-legacy-code.

**TypeScript full-stack profile.** `choosing-a-stack/references/ts-fullstack-profile.md` is one candidate for a new TypeScript web product or SaaS with one team and Postgres, never a default. Per role it gives a choice, the reason, when not to take it and an alternative, and it names no versions. If you pick it, `node <kit>/scripts/scaffold-template.ts <absolute dir> --postgres <major>` (`<kit>` is the folder the kit package is installed in, or a clone of the kit) copies `templates/ts-monorepo/` (pnpm workspaces, Turbo, a Vite web app, an Express API, Prisma with Kysely, CI). The template holds no versions: the script installs each package at its highest stable release that is at least a day old, capped at the major of a stable `latest` tag and pinned exactly, with `@types/node` at the Node major and workspace packages as `workspace:*`. The Postgres major is not guessed: pass `--postgres <major>` or `--postgres=<major>` (check the current supported major at postgresql.org; the script refuses without a positive integer, and refuses unknown options). It is written to `.postgres-version`, the single source like `.nvmrc`, and `pnpm db:up` and `pnpm db:down` run `node scripts/db.mjs up|down` (no shell, so it works on Windows too) to start and stop the local database from it; the database healthcheck waits for TCP. Four practices of that stack live in skills with no stack attached: monorepo CI in ci-quality-gates (affected-only, falls back to everything, one gate), one store until measured in backend-services (the existing database carries the queue, cache and locks until a measurement shows a separate service is needed), an enforced client/server boundary in web-frontend, and dependency discipline in updating-dependencies (every override and patch has a reason and a removal condition).

**Platforms:** web-frontend, backend-services, mobile-development (Android and iOS in `references/`), desktop-development (Windows and Linux in `references/`), ui-motion (animation and gestures on every platform: whether to animate at all, then easing, budgets, interruptibility, reduced motion; values and per-platform APIs in `references/`). web-frontend keeps state and optimistic updates, and the design system with destructive-action copy, in `references/`; mobile and desktop point to them. backend-services: its `references/` hold the feature-flag rules (OpenFeature in the code, a typed registry with safe defaults, owners and, for release and experiment flags, removal dates, evaluation that never throws and falls back to safe defaults, deterministic bucketing, server-side delivery, exposure-based experiments) and the API additions (internal RPC as a contract for open tabs, machine-readable error codes, resource checks after input validation).

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
| `reviewer` | opus, effort high | Read, Grep, Glob, Bash. Edits are forbidden through `disallowedTools` | The final review is the main quality decision, and it's worth spending on. A fresh context sees what the author's context hides. It reads the project's rules (CLAUDE.md or AGENTS.md, matching `.claude/rules/`, decision records the diff touches or cites). It reads them at the merge-base with the remote base (`{RULES_BASE}`) in every round. In a repeat round it reads the previous round's findings with `scripts/review-log.ts`. The guard limits its shell to git's read-only subcommands, a few read-only commands, worktrees at an absolute temp path, the verification commands and review-log, and refuses anything its parser might misread; it reads files with Read and Grep. The report ends with the `Reviewed BASE:`, `Reviewed HEAD:` and `Ready to merge:` lines, which the review gate reads |
| `implementer` | sonnet | all | One plan task with TDD. Status DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. The report is checked, not taken on trust |

Claude Code ignores the `hooks`, `mcpServers` and `permissionMode` fields for plugin agents, so they aren't used. The linter checks this. The model is overridden through `CLAUDE_CODE_SUBAGENT_MODEL` or at call time.

---

## 7. Guard: what it does

| Blocks (deny) | Asks (ask; denied in `-p`) |
|---|---|
| `--no-verify` and its abbreviations down to `--no-veri` (also inside groups and substitutions), `git commit -n` | `git push` other than your own work branch (below), publishing and releases |
| `push --force` / `-f` / `+ref` / `--mirror` | deploys, `terraform apply`, `kubectl apply`, `helm upgrade` |
| recursive `rm` outside the project and temp | DB migrations and rollbacks, `prisma db execute`, `DROP` / `TRUNCATE` |
| reading `.env*` (except `.example` and similar), keys, keystores, credentials (Read, Grep) | `git reset --hard`, `git clean -f`, `branch -D`, `sudo`/`doas`, `curl … \| sh` |
| writing into `.git/` and `protectedPaths` | shell access to secret files, writing a secret file |
| `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to the base while a task file is tracked | editing CI and release pipelines (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile` and similar) |
| the same, and a push to the branch of a PR the agent opened, without a reviewer `Yes` verdict for the commit being landed whose range reaches the remote base, or chained after anything but read-only steps and the project's verification commands (review gate); in the reviewer subagent, any shell command but inspection | editing `.claude/guard.json` (Edit/Write, or a non-read-only shell command naming it) |
| `git commit` on the base branch with a staged task file; writing into the review records (Edit/Write, or a shell command naming their path) | every PR/MR merge, `gh pr merge` or `glab mr merge` |

**Pushing the work branch.** A plain `git push` of the agent's own work branch passes without a question when all of these hold:

- the command is exactly `git [-C path] push [-u|--set-upstream|-q|-v|--progress|--no-progress|-n|--dry-run|--porcelain] [remote [refspec]]`, with no shell operators, quotes or variables (a trailing `2>&1` is allowed);
- the current branch is named by the convention `<type>/<kebab>` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`) and is not the base;
- the remote is configured and its effective push URL equals its configured URL;
- the push config adds nothing (no mirror, push refspecs, `followTags`, `pushOption`, `recurseSubmodules`, `receivepack` or unusual `push.default`) and no `GIT_*` redirect variable is set;
- the refspec, if any, names only the current branch;
- the repository is the session's project (same git common directory; worktrees count). A push from any other repository, such as one the agent cloned, asks.

The `implementer` subagent's own-branch push asks; a push that only an `allow` pattern quiets (a branch outside the convention) stays quiet for it too. Everything else that pushes still asks. `--force`, `-f`, `+ref` and `--mirror` stay blocked, and `--force-with-lease` asks. The review gate is unchanged: `gh pr create` / `glab mr create` and pushes to a PR branch the agent opened need a `Yes` covering HEAD; PR/MR merges (`gh pr merge`, `glab mr merge`) always ask, and so do pushes to the base.

Also asks, because they can point a push elsewhere or write outside the repository: `git remote add|set-url|rename|set-head`; `git config` writes to `remote.`, `url.`, `push.`, `branch.`, `alias.`, `include.` and `includeif.`, to keys that run a command (`core.pager`, `core.editor`, `core.askpass`, `core.hooksPath`, `core.sshCommand`, `core.fsmonitor`, `core.gitProxy`, `sequence.editor`, `diff.external`, `gpg.program`, `filter.*`, `pager.*`, diff and merge drivers, difftool and mergetool commands, `submodule.*.update`, credential helpers, `http.proxy`) and `git config -e`; `--config-env`, and `-c` with any of those keys; for the program-running ones (pager, editor, askpass, `sequence.editor`, `diff.external`, `gpg.program`, `filter.*`, `pager.*`, drivers, tool commands, `submodule.*.update`) a harmless value (empty, `cat`, `true` or `:`) stays quiet, while `core.hooksPath`, `core.sshCommand`, `core.fsmonitor`, `core.gitProxy`, `http.proxy` and credential helpers always ask; `git symbolic-ref` writes; `git update-ref --stdin` or on `refs/remotes`; `git svn dcommit|branch|tag|set-tree` and `git p4 submit|commit`; unknown git options before the subcommand; indirect git (`xargs git …`, wrappers such as `sudo`, `env`, `timeout`, `stdbuf`, `flock`, `ionice`, `taskset`, `chrt`, `setsid`, `unbuffer` and `doas`; a dashed `git-<sub>` is treated as `git <sub>`); `sh -c`, `bash -c` and `eval` strings that contain git; `gh api` and `glab api` writes (a non-GET method, field or input flags without a method, GraphQL mutations, and GraphQL queries taken from `$VAR`, `$(…)`, a `@file` or `--input`; an inline read query stays quiet); `prisma db execute`, `prisma migrate resolve` and `migrate:down` / `migrate rollback` runs; `doas`, `run0` and `pkexec`, like `sudo`. `--no-verify` is blocked inside groups and substitutions too. Everyday reads stay quiet: `git --version`, read-only git in substitutions, `git config <key>` with one operand, `git symbolic-ref` reads, and `git -c` with ordinary keys or a harmless value. A git variable that runs a program or redirects git also asks when it is set in front of a git call (`X=… git …`, `env X=… git …`) or exported in the same command (an `export NAME` by name asks too, also `declare -x` and `typeset -x`, after `{`, `then` and the like): the program-running group (`GIT_SSH_COMMAND`, `GIT_SSH`, `GIT_PROXY_COMMAND`, `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, and `PAGER`, `EDITOR`, `VISUAL` in front of a git call), the config-injection group (`GIT_CONFIG`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`) and the redirecting group (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_EXEC_PATH`, `GIT_NAMESPACE`, `GIT_TEMPLATE_DIR`). A harmless pager, editor or askpass value (empty, `cat`, `true`, `:`) and every other variable stay quiet.

**What the guard can't see.** A command guard reads the command, not the machine. It does not see indirect execution: quote-obfuscated shell strings (`sh -c 'g""it …'`), interpreter one-liners (`python -c "os.system('git …')"`), shells it doesn't list (`fish -c`), sourced scripts and script files, a setup command behind a wrapper the guard doesn't list (`find -exec`, `caffeinate`, `watch`), git under another name (a symlink or a copied binary) or through a relative path (`bin/git`), a variable exported in an earlier command (the hook's own environment is still checked for pushes), a variable placed before a program that runs git itself (`gh`, `npm install` with git dependencies, `make`, scripts), a variable already exported by the user's shell profile, proxy variables (`HTTPS_PROXY`, `ALL_PROXY`), `GIT_ALLOW_PROTOCOL`, and `export EDITOR=…` (by design), a `gh api` method set by a header override, and shell writes into `.git/config` or `.git/refs`. The review gate also does not read push refspecs set in `remote.<name>.push`, the other branches `push.default=matching` sends, `CDPATH`, or an `OLDPWD` left by an earlier command. Any of these can configure a remote or push. Like `curl`, exfiltration is not something the guard prevents. Server-side CI, review and branch protection carry the rest.

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
- **verdict** `Ready to merge: <exactly one of Yes, No, With fixes, Inconclusive>` and the `Reviewed BASE: <sha>` and `Reviewed HEAD: <sha>` lines; an echoed template (`Yes / No / …`) is not a verdict. Inconclusive means the reviewer couldn't read the requirements, the range or the rules;
- **no noise:** no praise and no made-up references.

**Review gate** (mechanics, not an instruction). The guard denies `gh pr create`, `glab mr create`, `git merge` into the base, `git push` to it and `git push` to the branch of a PR the agent opened (registered after a successful `gh pr create`/`glab mr create`, forgotten once the PR's head `origin/<branch>` is on the base, or after 30 days) unless the reviewer's last verdict for that commit is `Yes` and its range reaches the remote base: the record's `Reviewed BASE` is on the push remote's base branch (else `origin`'s, else any remote's; the local base only when no remote tracks it), or is a commit whose own review counts by the same rule, up to 20 rounds and 300 git calls. A round must start at the newest reviewed commit below it, so no round's findings are skipped. A repeat round reviews only the new commits; its reviewer reads the previous round's reports with `scripts/review-log.ts`, not from the author. An empty range, a range broken by a rebase and a record without a range cover nothing. The verdict record is written by the `SubagentStop` hook; a review that ran while the session's edits were unverified (in a project with verification commands) is recorded as `Inconclusive`. A verdict covers exactly the commit the reviewer reviewed: any change after it (a new commit, an amend, a rebase onto a newer base, a docs edit, deleting the task file) needs a new review, and a branch that changes only documentation is reviewed the same way, so the final review comes last, after docs, the task-file removal and any rebase. Commits already on the remote base land nothing new. The guard follows only a plain move: `cd`, `pushd` or `popd` as the command's first word, not in a pipeline, after `||` or in a list sent to the background, with at most `-L`/`-P` and `--` and one folder written literally or as `~`, `-` or `~-` (harmless redirections such as `2>/dev/null` are fine), in a command with no comment, unquoted `$(…)` or backtick (a quoted substitution stays one word and can't move the shell), process substitution, brace group, `|&` or `case`; after `-P` the guard uses the real folder. A move after `&&` counts only while the `&&` chain lasts. `git -C <dir>` is followed from the folder the moves lead to, so a worktree's branch is checked where the command runs. A `git push` without a refspec is checked where git would push it (`@{push}`: `push.default`, the upstream, `pushRemote`); a refspec set only in `remote.<name>.push` config and the other branches `push.default=matching` sends are not read. Redirections are read as the shell reads them (`>|`, `>& file`, and `&>` with or without a space before it). Any other move, a nested subshell, a `)` inside `$(…)`, or a parenthesis in quotes or after a backslash inside a command that opens a subshell makes the folder unknown: the landing fails closed. `CDPATH` and an `OLDPWD` left by an earlier command are not read. The review records' protection checks every folder any move in the command may reach, expanding `$HOME` and `$TMPDIR` too; a move it doesn't follow exactly, or more than 256 candidate folders, makes it ask before any command that may write. A read-only command with a substitution or git's `--output` counts as a writer, and a path after `=` (`of=…`) or inside a quoted substitution is checked too. A landing chained after anything but read-only steps and the project's verification commands (`git commit … && gh pr create`, `git switch main && git merge …`) is denied: the guard can't see what it lands. PR/MR merges (`gh pr merge`, `glab mr merge`) always ask, with or without a `Yes`, and the gate may also refuse one without a `Yes`; `gh pr create --head <branch>` checks that branch. `With fixes`, `No` and `Inconclusive` don't pass: fix and review the new range. A finding the author declined without a code change is cleared by a repeat review in the next prompt, after the user has seen the arguments. Only the user turns the gate off: `"reviewGate": false` in `.claude/guard.json`; the guard asks before that file is changed (Edit/Write or shell) and denies writes to the review records. It protects against a forgotten or skipped review, not against an agent that deliberately feeds the reviewer a ready answer.

**Responding to review** (`receiving-code-review`): every comment is either fixed or answered; none is skipped silently. You can't write "resolved" while a blocker is open or until a repeat review has closed the finding. A finding or correction that will recur becomes a proposed check or rule, the strongest level first (a mechanical check, then a project rule, then a kit change through writing-skills); the user decides, and open proposals join the task's Follow-ups.

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
  - focused tests and skips without a linked issue (`#123`, a URL or `ABC-123`; a reason in words is not enough, except reasons starting with `platform:`/`mode:`) in JS/TS (Playwright `test.describe.only/skip/fixme`, Cypress, Mocha and Nest layouts), Python, JVM, Go, Swift, .NET, Gherkin; fixed sleeps; retries in runner configs and in test code (`this.retries`, `describe.configure`, pytest `flaky`);
  - `--junit <dir>` alone checks only the reports: missing or empty, or a declared count that differs from the cases that ran (a crashed shard).

  In an existing project it is a ratchet: only lines the change adds count (renames are followed), and pre-existing debt is counted in the summary, not blocking (`--all` checks every line). Without a merge base it stops with a message: CI needs `fetch-depth: 0` and, on GitLab, an explicit fetch of the target branch. `test-hygiene: allow <reason>` marks a line where the pattern is the behavior under test; an allow without a reason is itself reported, and one that hides a forbidden skip, retry or sleep needs your agreement. `.ci/test-hygiene.json` adds test files, ignores and patterns. Next to it go the stack's native linters (table in `ci-quality-gates/references/ci-templates.md`).
- **Verify commands in a Turbo monorepo.** With a `turbo.json` (or `turbo.jsonc`, comments allowed) `kit-init` detects one `<exec> turbo run typecheck lint test` built from the tasks it declares; a `pkg#task` key declares `task`, and `<exec>` is `pnpm`, `yarn`, `bunx --no-install` or `npx --no` by lockfile, so only a locally installed turbo runs. A manifest's Commands still win, and a `turbo.json` that can't be read or declares none of those tasks falls through to the `package.json` scripts. `pnpm-workspace.yaml` alone selects pnpm. CI coverage: a Turbo verify command counts as covered when a CI step runs `turbo run` with all its tasks, in any order and with harmless flags (`--affected`, `--continue`, `--cache-dir` and other output or performance flags); `--filter`, `-F` or `--dry-run` narrow the run, so they don't cover. Other commands are matched as text.
- **Reversible template migrations.** Every migration in the `ts-monorepo` template ships a `down.sql`. `pnpm --filter @repo/db migrate:down <name>` reverts the latest applied migration with it, in one transaction, and marks the history row rolled back; `migrate deploy` applies it again. Prisma has no down migrations of its own and `migrate resolve --rolled-back` accepts only failed ones, so the script updates the row itself. Run it only after the code that needs the migration was rolled back; it reverts the schema, not data, and the guard asks before it runs. `template-smoke` checks deploy, revert to an empty schema and deploy again.
- **A DB job in the template's CI.** The template's `pr.yml` has a `db` job in the gate (`needs`): it starts Postgres with `pnpm db:up`, deploys, reverts the latest migration, checks that the schema is empty, deploys again and checks that it matches `schema.prisma`. No Postgres version is written in the workflow. The kit's own `template-smoke` scaffolds with `--postgres 18`.
- **Linking the layers:**
  - `kit-init` mechanically checks that CI runs every verify command, has the working-docs job and runs `.ci/test-hygiene.mts` when the project has it, and reports a copy older than the kit's;
  - review counts a command missing from CI and a broken project rule as Important, and a removed, skipped or retried check as Critical.
- **BDD** is an optional acceptance layer (`test-driven-development/references/bdd.md`). Each user-visible criterion of the task file is exactly one scenario tagged with the criterion. The result is a chain "criterion → scenario → CI", and review checks the tags against the task file.

---

## Testing

The foundation is the iron rule of TDD: a failing test first, then minimal code, then a run of the whole suite. Every other test rule lives in one place, the standard `test-driven-development/references/test-standard.md`; TDD, BDD, writing-plans and the review checklist link to it instead of restating it:
- **expected values** come from the task file's criterion, not from the code's output. The one exception is characterization tests of legacy code: `*.char.test.*` (or the stack's tag), they pass on first run by design and don't count as coverage of new behavior. Golden data in a port is an acceptance test that fails first, not characterization;
- **seen failing first:** every new test, except a characterization test;
- **a test must pay for itself:** no tests of constants, config, schema shape, "it renders", echoing a mock; identical cases are merged into a parameterized test; snapshots are small and inline;
- **structure and names:** Arrange–Act–Assert, one behavior per test, name = subject + circumstance + result; test-only helpers live in test code (except a provider fake or flag override that configuration selects and a startup check refuses in production);
- **mocks:** only unmanaged dependencies are faked; your own DB and queues are real in integration tests. Provider sandboxes are a separate suite and CI job, the only place a test talks to the network;
- **determinism and isolation:** time and randomness under control, no network, a run outside UTC; waits are on a condition with one project-wide ceiling, never a fixed sleep; tests run in any order and in parallel; missing test infrastructure (a database, a container, an emulator) fails the run, never skips it;
- **no retries:** a test never retries, not in the runner config, not in CI, not in a loop. Waiting on a condition (web-first assertions, `expect.poll`, `waitFor`) is not a retry. A flake is fixed only when five criteria hold: the failing run and boundary found, the root cause removed, a repeated run green on the same commit, green in the configuration where it failed, the full suite green;
- **criteria and levels:** with BDD a user-visible criterion has exactly one scenario tagged with it; any other criterion has at least one test at the cheapest level that shows it the way a user or caller sees it; end-to-end without BDD covers critical flows only, one journey each;
- **manual check** replaces a test only where automation is impossible (real hardware, a store review, a fiscal device, a physical signature): the task file gives the reason, you agree, the report says it ran. Elsewhere a criterion without a test is a gap;
- **outside-in with BDD:** the scenario is written first and seen failing, unit TDD cycles drive the code, and the scenario passing closes the criterion. The unit tests underneath test their unit's own contract and stay; only a unit test asserting the user-level outcome the scenario already proves is left out;
- **changing tests:** deleting a test together with its behavior, or one that never protected anything, needs only the reason in the commit; editing an assertion, deleting a test whose behavior still exists, or a skip or quarantine needs your agreement and its own commit; a skip names a linked issue (a platform or test-mode skip whose reason starts with `platform:` or `mode:` is the one exception). `test-hygiene: allow <reason>` is for a pattern that is the behavior under test; using it to hide a forbidden skip, retry or sleep needs your agreement, and review rates it like the pattern;
- **coverage** is a floor, not a goal; visual baselines are produced only in CI.

The plan names the test for each criterion, and the PR body says how each new test was seen failing first. The reviewer checks the rules with the checklist's fixed severities. The mechanical layer (the `test-hygiene` script and the stack's linters) is added by ci-quality-gates only with your "yes".

---

## 8. Principles built into the plugin

1. Three process paths instead of one heavy one, so small tasks don't drown in bureaucracy.
2. Methodology in skills, mechanics in hooks, thin entry points. The rules for done live in one place.
3. Built-in features aren't duplicated. `Explore` is there for exploration. Models are set through frontmatter (`model:` for agents, `effort: high` for heavy skills); there's no custom routing config. The team pin is the native `--scope project`.
4. No narrow vendor skills. Project specifics go into the project's CLAUDE.md.
5. The agent pushes its own convention-named work branch without a question; every other push asks, and merging, pushing to the base and rewriting pushed history stay yours. A project with another branch convention adds a narrow `allow` in `.claude/guard.json`, for example `^git push( -u)? origin (story|task)/[a-z0-9._-]+$`. `allow` skips all of the guard's questions for the matching command, so keep patterns anchored.
6. Skills are in English: triggering is more precise that way. Documentation is in English, with a Russian version of each file (`*.ru.md`).

---

## 9. How it's verified

- **`npm test`**:
  - guard (the own-branch push classifier: the silent forms, every ask and block, config, environment and remote checks; block, ask, allow, config, paths, temp, working documents, review gate: verdict record, verdict merging, parallel runs, code after review, deleting a task file, remote base, rebase, worktree and `cd`, chained landings, PR/MR merges, shell writes, a review of unverified edits as Inconclusive, the range chain (narrow BASE, empty range, rebase, 20 rounds, no remote), review-log, open-PR pushes, the reviewer's shell allowlist, a symlinked project);
  - the command parser and the evidence rule;
  - hook handlers (SessionStart, PreToolUse for Bash, PowerShell, Read, Grep, Edit, NotebookEdit; the tracker and the Stop gates);
  - `hook.ts` over stdin/stdout, including unparsable input (exit 1); `respond()` with a throwing handler (PreToolUse asks, other events exit 1);
  - `verify.ts`;
  - `test-hygiene.ts` (rules in 7 languages, ratchet with renames, no merge base, JUnit reports only, config, CLI);
  - `kit-init` (including the test-hygiene item: offered, copied with `--test-hygiene`, an older copy reported and replaced with the flag, a CI that doesn't run it reported in the same run);
  - `install-project` (install, update, conflicts, hooks without duplicates);
  - the skill and agent linter, manifest consistency.
  - the `ts-monorepo` template (no versions, `scaffold.json` names real workspaces, pinned action SHAs) and the scaffold script (refuses a non-empty folder, the planned installs, `.nvmrc`, `packageManager`, `.postgres-version` and argument parsing);
- **`npm run typecheck`** and **`claude plugin validate .`**.
- **`template-smoke`** (`.github/workflows/template-smoke.yml` in the kit's own CI, weekly and on PRs that touch the template or the scaffold script): scaffolds `ts-monorepo` with `--postgres 18` into a clean folder, starts Postgres with `pnpm db:up`, runs `pnpm turbo run typecheck lint test`, `prisma migrate deploy`, `migrate:down` to an empty schema and `prisma migrate deploy` again against Postgres. It is outside `gate` and the release: red means the ecosystem moved and the template needs a fix.
- **A live `claude -p` run** on a copy of `examples/demo`:
  - bootstrap;
  - deny on `git commit --no-verify`;
  - ask and denial on `git push`;
  - the Stop gate after an Edit without tests sent the agent back to `npm test`;
  - folder mode: bootstrap and guard from `.claude/eng-kit`;
  - install through `--scope project` from a local marketplace;
  - review gate (claude 2.1.285, `--plugin-dir`, a copy of `examples/demo` with planted defects): a PR without review was denied; the `reviewer` agent found float rounding of money (Critical, with rule quotes from CLAUDE.md, the task and the checklist) and an uncovered criterion, verdict `No`, denied again; after the fixes the repeat round over the new range re-checked the old findings, `Yes`, and the guard let `gh pr create` through.

**Not verified:** Windows (the PowerShell tool and running the hook through `cmd`), a live run of the `implementer` agent; the own-branch push has no live run yet, its live check is the first push of the branch that ships it.

**Known limits of the own-branch push:** see "What the guard can't see" in section 7; server-side CI, review and branch protection carry what a command guard can't.

**Known limits of the review gate:** an interpreter one-liner can still hide a path from the shell checks; the gate protects against a forgotten review, not against an agent that deliberately feeds the reviewer a verdict; it sees only PRs this agent opened, not ones opened in the browser or by another tool; the gate trusts the range the reviewer names; the reviewer's shell allowlist is a parser-based check that refuses what it can't read exactly, not a sandbox; remote-tracking refs are local, so `git update-ref` can fake a merged PR or an already-landed commit; a hook that can't start, runs past its timeout or gets unparsable input lets the call through; the main agent's command parser doesn't follow heredocs or `#` comments, so a landing after one of them may go unseen; in a project install the agent can edit the kit's own files; with no resolvable base branch (no `origin/HEAD`, no `main`/`master`) it does nothing.

**Evals.** `evals/` holds six tasks (TDD on a spec, bug root cause, no test weakening under pressure, secrets stay out, verify before done, money in minor units) that `claude plugin eval` runs with the kit and with no plugin; the score difference is what the kit adds. Fixtures are small git repos created by each case's `scaffold.sh`; each case has graders on the result and on the steps, with a judge only where a pattern can't decide. The folder install never copies `evals/`. The first run (Sonnet; the skills the cases use unchanged since 0.19.0) gave a mean Δ of +0.11: with the kit the agent's bug fixes validate the whole input more often, and the agent keeps out of `.env` and writes the test before the code; on the other three tasks the model already scores 1.0 without it. Results and caveats: `docs/EVALS.md`.

---

## 10. How to extend it

- A new skill is written with `writing-skills`: first a scenario without the skill (RED), then a minimal skill. Then `npm test`, `claude plugin validate .` and a line in this document. Subagents are written the same way, with `writing-skills/references/agents.md`.
- A rule that can be checked mechanically lives in a hook, in `permissions` in settings.json or in CI, not in a skill's text.
- A template holds no versions: they are installed from the registry at scaffold, and `template-smoke` shows when the ecosystem has moved.
- Domain plugins for a specific company (a specific acquirer, fiscal data operator) are better made as a separate plugin and connected through `dependencies` in `plugin.json`.
