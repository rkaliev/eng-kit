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
  - **guard** (PreToolUse) denies irreversible or secret-leaking tool calls and PRs or merges that would carry working documents to the base branch, and asks you before outward-facing ones.
  - **verify gate** (PostToolUse + Stop) won't let Claude finish with unverified edits.
  - **approval gate** and **working-docs gate** (Stop) won't let Claude finish while an approved spec or plan is uncommitted, or while an implemented plan or roadmap is still in the tree.

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

1. Run `/eng-kit:kit-init` (`/kit-init` in folder mode). It shows a dry run first, then creates the missing files: `.claude/verify.json` (commands detected from CLAUDE.md or AGENTS.md, package scripts or build tools), `.claude/guard.json`, and deny rules in `.claude/settings.json`. If only AGENTS.md exists, it creates a `CLAUDE.md` that imports it (`@AGENTS.md`). It never overwrites files.
2. Run `/onboarding-existing-codebase` when CLAUDE.md is missing or stale. It maps the repo, proves the commands, and proposes CLAUDE.md from [templates/CLAUDE.md](templates/CLAUDE.md).
3. Describe tasks with [templates/task.md](templates/task.md): numbered, testable criteria (`/new-task` writes one).

A typical loop:

```
/brainstorming add refunds to the checkout API     # design approved before code
/writing-plans docs/specs/2026-09-26-refunds.md    # bite-sized TDD tasks
/implement docs/plans/2026-09-26-refunds.md        # executes, verifies; moves what lasts to docs/, deletes spec and plan
/requesting-code-review                            # reviewer agent: Confirmed vs Assumptions
/finish                                            # verify → merge / PR / keep / discard
```

Small, bounded changes go straight to `/implement tasks/01-search-filter.md`.

## Hooks

### guard

| Denies | Asks first (denied in `-p` / headless) |
|---|---|
| `--no-verify`, `git commit -n` | `git push`, publish and release commands |
| `push --force` / `-f` / `+ref` / `--mirror` | deploys, `terraform apply`, `kubectl apply`, `helm upgrade` |
| recursive `rm` outside the project and temp dirs | DB migrations, `DROP` / `TRUNCATE` |
| reading `.env*`, keys, keystores and credential files (Read, Grep) | `git reset --hard`, `git clean -f`, `branch -D`, `sudo`, `curl … \| sh` |
| writing into `.git/` and `protectedPaths` | shell access to secret files, writing a secret file |
| `gh pr create/merge`, `glab mr create/merge`, merging into or pushing to the base branch while specs, plans or ledgers are tracked; committing them on the base branch | editing CI and release pipelines |

`.claude/guard.json` has five keys: `block`, `confirm`, `allow` (regex sources), `protectedPaths` (path prefixes) and `workDocs` (the working-document folders, default `["docs/specs", "docs/plans"]`; `[]` turns that rule off). `allow` only relaxes a confirmation, never a denial. The guard never *grants* permission, so your own `permissions` rules still apply.

### verify gate

- **Commands** come from `.claude/verify.json` (`{"commands": [...], "timeoutSec": 600}`). Without it, they come from the `## Commands` section of CLAUDE.md or AGENTS.md (test, typecheck, lint and build lines; dev and watch commands are skipped).
- **`/verify`**, or the verify script directly (`node <kit>/scripts/verify.ts`), runs them and prints PASS/FAIL with the failing output tail. The session context carries the exact path.
- **What counts as unverified:** an Edit/Write/MultiEdit/NotebookEdit of a file inside the project makes the workspace unverified until every command passes. Files matching `ignore` in `.claude/verify.json` don't count (default: `**/*.md`, `**/*.mdx`, `**/*.txt`, `docs/**`; set `"ignore": []` if your checks lint docs). Neither do files outside the project, such as plans or memory.
- **What counts as a green run:** the verify script (it records its own result, so piping its output is fine), or an exact, unpiped Bash run of each command. A background run doesn't count when it starts.
- **Stop:** if Claude stops while the workspace is unverified, the Stop hook sends it back once per user prompt, asking for evidence.

### approval and working-docs gates

Working documents (specs, plans and their ledgers) live only on the work branch. At Stop, once per user prompt:
- a spec or plan marked `Status: approved` that isn't committed sends Claude back to commit it, on a work branch;
- a plan whose checkboxes are all ticked, or a roadmap with no open piece, sends Claude back to move what lasts into `docs/` and delete it.

A roadmap may stay on the base branch while it has open pieces. For people and other tools, the ci-quality-gates templates add a `working-docs` CI job that fails the same way.

## Models

- `reviewer` → `opus`, `implementer` → `sonnet`. The heavy-reasoning skills (brainstorming, writing-plans, systematic-debugging, security-review) set `effort: high`.
- Override everything with `/model`, or with `CLAUDE_CODE_SUBAGENT_MODEL` for subagents.

## Develop

```bash
npm install
npm test                  # hook handlers, hook e2e over stdin, init, install, skill/agent linter
npm run typecheck
claude plugin validate .
```

Edit skills with the `writing-skills` skill, and keep `docs/ARCHITECTURE.md` and `docs/ARCHITECTURE.ru.md` in sync.

## License

MIT, see [LICENSE](LICENSE). Third-party notices: [NOTICE.md](NOTICE.md).
