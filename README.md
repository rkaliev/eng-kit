# eng-kit

A [Claude Code](https://code.claude.com) plugin that turns Claude into a disciplined engineer.

It works on any project, and it adapts along three independent axes:
- **where the code runs:** web, mobile (Android, iOS) or desktop (Windows, Linux);
- **what it does:** anything from entertainment apps to point-of-sale systems and payments, with dedicated skills where mistakes are costly (money, fiscal rules, security);
- **what state the code is in:** a brand-new project or an existing codebase, including one written long before AI agents.

The process on top of them is the same everywhere: design → plan → TDD → verify → review → git.

It contains:
- **34 skills:**
  - **process core:** design, plan, TDD (with optional BDD), debugging, verification, review, git, CI quality gates, documentation, dependency updates;
  - **starting point:** choosing a stack for a new project, onboarding an existing one, changing legacy code safely;
  - **platforms:** web frontend, backend services, mobile, desktop, and UI motion across them;
  - **high-risk domains:** payments and money, POS and fiscal, security review, observability, database changes;
  - **entry points:** `/implement`, `/finish`, `/new-task`, `/verify`, `/kit-init`, `/docs`.
- **2 agents:**
  - `reviewer` is read-only, runs on opus and does fresh-context reviews;
  - `implementer` runs on sonnet and executes one plan task at a time.
- **Hooks:**
  - **bootstrap** (SessionStart) loads the skill rules into every session and brings them back after compaction.
  - **guard** (PreToolUse) denies irreversible or secret-leaking tool calls and PRs or merges that would carry task files to the base branch, and asks you before outward-facing ones.
  - **verify gate** (PostToolUse + Stop) won't let Claude finish with unverified edits.
  - **approval gate** and **working-docs gate** (Stop) won't let Claude finish while an approved task file is uncommitted, or while an implemented one is still in the tree.
  - **review gate** (SubagentStop + PreToolUse) denies opening or merging a PR, or landing on the base branch, unless the reviewer's last verdict for that commit is `Yes`. A review that ran on unverified edits counts as `Inconclusive`.
- **A test-hygiene script** for the project's CI on any stack (`scripts/test-hygiene.ts`, Node only, no dependencies): focused tests, skips without a linked issue, fixed sleeps, retries in runner configs and test code, JUnit test counts. In an existing project it checks only the lines a change adds, so old debt doesn't block.

Docs: [what plugins are and how to install this one, step by step](docs/GETTING-STARTED.md), [a new project from scratch](docs/WALKTHROUGH.md), and [how the kit works and why](docs/ARCHITECTURE.md). In Russian: [GETTING-STARTED.ru.md](docs/GETTING-STARTED.ru.md), [WALKTHROUGH.ru.md](docs/WALKTHROUGH.ru.md), [ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md).

**Requires:** Claude Code (latest) and Node.js ≥ 22.18. The hooks are `.ts` files that Node runs directly.

## Install

### A. As a plugin (recommended)

Once per machine. The plugin is then available in every project:

```bash
claude plugin marketplace add rkaliev/eng-kit
claude plugin install eng-kit@eng-kit
```

For a team, pin it in the project and commit `.claude/settings.json`. Everyone who opens the project and trusts the folder is offered the plugin:

```bash
claude plugin marketplace add rkaliev/eng-kit --scope project
claude plugin install eng-kit@eng-kit --scope project
```

To try a local clone for one session only: `claude --plugin-dir ./eng-kit`.

Skills are namespaced: `/eng-kit:implement`, `/eng-kit:brainstorming`, …

### B. As a `.claude/` folder in the project

```bash
git clone https://github.com/rkaliev/eng-kit
node eng-kit/scripts/install-project.ts <project>          # dry run
node eng-kit/scripts/install-project.ts <project> --yes    # install or update
```

The script puts:
- skills into `.claude/skills/`;
- agents into `.claude/agents/`;
- hook code into `.claude/eng-kit/`;
- hooks and secret deny rules into `.claude/settings.json`.

Re-running updates only the files the kit wrote before (tracked in `.claude/eng-kit/manifest.json`). Project files are never overwritten. Use one mode per project, not both.

## Set up a project

1. Run `/eng-kit:kit-init` (`/kit-init` in folder mode). It shows a dry run first, then creates the missing files: `.claude/verify.json` (commands detected from CLAUDE.md or AGENTS.md, package scripts or build tools), `.claude/guard.json`, and deny rules in `.claude/settings.json`. If only AGENTS.md exists, it creates a `CLAUDE.md` that imports it (`@AGENTS.md`). It never overwrites files other than an older copy of the kit's test-hygiene script. It also offers the test-hygiene script and copies it into `.ci/test-hygiene.mts` (an ES module whatever `package.json` says) only if you agree (`--test-hygiene`, which also replaces an older copy); it reports an older copy and a CI that doesn't run it.
2. Run `/onboarding-existing-codebase` when CLAUDE.md is missing or stale. It maps the repo, proves the commands, and proposes CLAUDE.md from [templates/CLAUDE.md](templates/CLAUDE.md).
3. Each piece of work gets one task file from [templates/task.md](templates/task.md): description, numbered testable criteria, plan and progress in `docs/tasks/` (`/new-task` writes the description).

A typical loop:

```
/brainstorming add refunds to the checkout API     # docs/tasks/2026-09-26-refunds.md, design approved before code
/writing-plans docs/tasks/2026-09-26-refunds.md    # fills its Plan: bite-sized TDD tasks
/implement docs/tasks/2026-09-26-refunds.md        # executes, verifies; moves what lasts to docs/, deletes the task file
/requesting-code-review                            # reviewer agent: Confirmed vs Assumptions
/finish                                            # verify → merge / PR / keep / discard
```

Small, bounded changes go straight to `/implement add a case-insensitive search filter`, with no file.

## Hooks

### guard

| Denies | Asks first (denied in `-p` / headless) |
|---|---|
| `--no-verify`, `git commit -n` | `git push`, publish and release commands |
| `push --force` / `-f` / `+ref` / `--mirror` | deploys, `terraform apply`, `kubectl apply`, `helm upgrade` |
| recursive `rm` outside the project and temp dirs | DB migrations, `DROP` / `TRUNCATE` |
| reading `.env*`, keys, keystores and credential files (Read, Grep) | `git reset --hard`, `git clean -f`, `branch -D`, `sudo`, `curl … \| sh` |
| writing into `.git/` and `protectedPaths` | shell access to secret files, writing a secret file |
| `gh pr create/merge`, `glab mr create/merge`, merging into or pushing to the base branch while task files are tracked; committing them on the base branch | editing CI and release pipelines |
| the same without a reviewer `Yes` for the commit being landed, or chained after anything but read-only steps and the project's verification commands (review gate); writing into the review records | editing `.claude/guard.json` (Edit/Write, or a shell command naming it); `gh pr merge <number\|URL>` (review gate) |

`.claude/guard.json` has six keys: `block`, `confirm`, `allow` (regex sources), `protectedPaths` (path prefixes), `workDocs` (the task-file folders, default `["docs/tasks"]`; `[]` turns that rule off) and `reviewGate` (`false` turns the review gate off). `allow` only relaxes a confirmation, never a denial. The guard never *grants* permission, so your own `permissions` rules still apply.

### verify gate

- **Commands** come from `.claude/verify.json` (`{"commands": [...], "timeoutSec": 600}`). Without it, they come from the `## Commands` section of CLAUDE.md or AGENTS.md (test, typecheck, lint and build lines; dev and watch commands are skipped).
- **`/verify`**, or the verify script directly (`node <kit>/scripts/verify.ts`), runs them and prints PASS/FAIL with the failing output tail. The session context carries the exact path.
- **What counts as unverified:** an Edit/Write/MultiEdit/NotebookEdit of a file inside the project makes the workspace unverified until every command passes. Files matching `ignore` in `.claude/verify.json` don't count (default: `**/*.md`, `**/*.mdx`, `**/*.txt`, `docs/**`; set `"ignore": []` if your checks lint docs). Neither do files outside the project, such as plans or memory.
- **What counts as a green run:** the verify script (it records its own result, so piping its output is fine), or an exact, unpiped Bash run of each command. A background run doesn't count when it starts.
- **Stop:** if Claude stops while the workspace is unverified, the Stop hook sends it back once per user prompt, asking for evidence.

### approval and working-docs gates

Task files (`docs/tasks/YYYY-MM-DD-<slug>.md`: description, plan and progress) live only on the work branch. At Stop, once per user prompt:
- a task file marked `Status: design approved` or `plan approved` that isn't committed sends Claude back to commit it, on a work branch;
- a task file whose Plan checkboxes are all ticked sends Claude back to move what lasts into `docs/` and `docs/decisions/`, show you its Follow-ups, and delete it.

For people and other tools, the ci-quality-gates templates add a `working-docs` CI job that fails on any tracked `docs/tasks/*.md`.

### review gate

When the kit's `reviewer` agent finishes (`reviewer` or `eng-kit:reviewer`; other plugins' reviewers don't count), the SubagentStop hook reads its `Reviewed HEAD: <sha>` and `Ready to merge: <one of Yes, No, With fixes, Inconclusive>` lines and records the verdict for that commit. A report without them sends the reviewer back once to add them. The guard then denies `gh pr create/merge`, `glab mr create/merge`, merging into or pushing to the base branch unless the last verdict for the commit being landed is `Yes`:
- `With fixes`, `No` and `Inconclusive` don't pass: fix and review the new range;
- a verdict covers exactly the commit the reviewer reviewed: any change after it (a new commit, an amend, a rebase onto a newer base, a docs edit, deleting the task file) needs a new review, and a branch that changes only documentation is reviewed the same way, so the final review comes last, after docs, the task-file removal and any rebase. Commits already on the remote base land nothing new;
- `cd <dir>` and `git -C <dir>` are followed, so a worktree's branch is checked. Land in a command of its own: a landing chained after anything but read-only steps and the project's verification commands is denied; `gh pr merge <number>` asks, because the PR head isn't known locally;
- only you turn it off, with `"reviewGate": false` in `.claude/guard.json`.

## Models

- `reviewer` → `opus`, `implementer` → `sonnet`. The heavy-reasoning skills (brainstorming, writing-plans, systematic-debugging, security-review) set `effort: high`.
- Override everything with `/model`, or with `CLAUDE_CODE_SUBAGENT_MODEL` for subagents.

## Develop

```bash
npm install
npm test                  # hook handlers, hook e2e over stdin, init, install, test-hygiene, skill/agent linter
npm run typecheck
claude plugin validate .
```

Edit skills with the `writing-skills` skill, and keep `docs/ARCHITECTURE.md` and `docs/ARCHITECTURE.ru.md` in sync.

**Releasing:** bump `version` in `package.json` and `.claude-plugin/plugin.json`, add its `## X.Y.Z` section to `CHANGELOG.md`, and merge to `main`. CI checks both on every PR, and after a green run on `main` it creates the `vX.Y.Z` tag and GitHub Release with that section as the notes.

## License

MIT, see [LICENSE](LICENSE). Third-party notices: [NOTICE.md](NOTICE.md).
