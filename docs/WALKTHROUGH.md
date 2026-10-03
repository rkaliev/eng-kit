# A new project from scratch: a step-by-step example

Russian version: [WALKTHROUGH.ru.md](WALKTHROUGH.ru.md)

This is the whole path from an empty folder to the first merge. The example project is `shop-api`, a REST API for an online store cart. What plugins are and what other install options exist is described in [GETTING-STARTED.md](GETTING-STARTED.md).

## Step 0. Install the plugin (once per machine)

```bash
claude plugin marketplace add rkaliev/eng-kit
claude plugin install eng-kit@eng-kit
```

After this the plugin works in **all** projects; you don't need to install it again.

## Step 1. Create the project

```bash
mkdir shop-api && cd shop-api
git init
claude
```

Claude Code asks whether you trust the folder; answer "yes". Nothing else is needed:
- at startup the plugin loads the rules itself: check skills first, evidence before "done", questions at forks, don't read secrets;
- the guard and the verify gate turn on.

## Step 2. Describe the idea in plain words

```
I want a REST API for an online store cart: products, percentage discounts, total. Money is calculated exactly.
```

You don't have to type a command. Claude sees that the task fits the `brainstorming` skill and loads it. You can also call it explicitly: `/eng-kit:brainstorming …`. What happens:

1. **Classification out loud:** "This is a new project, the Architectural path."
2. **Questions one per message,** for example "Where will it run?", "Do we need a DB, or is memory enough for now?".
3. **Domain questions come in by themselves.** The task is about money, so `payments-and-money` loads with questions about currency, rounding and idempotency. They are asked right away because changing them later is expensive.
4. **Choosing the stack is always your decision.** There will be 2–3 options (for example, TypeScript + Fastify, Kotlin + Spring, Go) with pros and cons and a recommendation. You choose. For a TypeScript web product or SaaS with Postgres, the kit's proven full-stack profile can be one of the options; it is never the default.
5. **The task file** is written on a work branch to `docs/tasks/2026-09-26-cart-api.md`: your request verbatim, then the description (intent, criteria, scope, decisions, design). The agent asks you to approve it, and on your "yes" sets `Status: design approved` and commits. One task file per piece of work stands in for a tracker issue: the plan and the progress record are added to the same file later. It lives only on the work branch and never reaches `main`.

**Until you say "yes", no code is written.** This is a hard rule of the skill.

## Step 3. Scaffold and checks

After your "yes" the agent creates the scaffold with the stack's official tool (for the TypeScript profile, the kit's `scripts/scaffold-template.ts <absolute dir> --postgres <major>`, with the major checked at postgresql.org): it pins versions and adds the test, lint and typecheck commands. Then:

```
/eng-kit:kit-init
```

The agent shows a plan and after your "yes" creates three things:
- `.claude/verify.json`: the project's verify commands, for example `npm test` and `npm run typecheck`;
- `.claude/guard.json`: the guard rules for the project;
- deny rules for `.env` and keys in `.claude/settings.json`.

If there is no CLAUDE.md yet, the agent offers to build it from the code.

## Step 4. Plan

```
/eng-kit:writing-plans docs/tasks/2026-09-26-cart-api.md
```

The plan goes into the `## Plan` section of the same task file, and `Base:` records the commit it was written from. The plan is small tasks with `- [ ]` checkboxes, each with the exact files and the tests that prove it's done. At the end there is a "Post-implementation" block: which documentation the change will make stale (README, docs, CHANGELOG, CLAUDE.md) and what to update in it. Then the agent asks how to execute and recommends one of the options:
- **inline**: in this same session, cheaper;
- **subagent per task**: a fresh `implementer` agent for each task plus a check by the `reviewer` agent; more expensive, but more reliable.

This is the second approval: on your "yes" the status becomes `plan approved` and the file is committed again.

## Step 5. Implementation

```
/eng-kit:implement docs/tasks/2026-09-26-cart-api.md
```

The file has a filled Plan, so `implement` hands it to `executing-plans`.

- **A separate branch:** the agent doesn't work on `main` without your consent.
- **Progress:** the `## Progress` section of the task file records the baseline, drift, rulings and a `Task N: complete (…)` line per task, while the Plan's checkboxes get ticked. If the context runs out or you close the session, the next session continues from the same place.
- **Test first in every task:** first a test that fails, then the code, then a green run.
- **If the agent wants to finish too early,** the hook sends it back: "Verify gate: files changed…". The agent runs the checks and only then reports.

The final report has the changed files, the commands with real results, each criterion and how it was checked, and what wasn't checked.

## Step 6. Review and finish

```
/eng-kit:requesting-code-review
```

The `reviewer` agent (opus, read-only) looks at the diff with fresh eyes and against the project's rules (CLAUDE.md, `.claude/rules/`, decision records). You get "Confirmed" issues with `file:line` and evidence, "Assumptions" and a verdict. The agent fixes Critical and Important.

Then the agent closes the task file:
- behavior goes into the topic chapter, for example `docs/02-cart.md`;
- decisions and lasting rulings go into `docs/decisions/` (for example, "money in integer minor units");
- you are shown its Follow-ups, if any, and offered to start the next one;
- the file is deleted in one commit, `docs: remove the task file for cart-api`. Git keeps it.

If the agent forgets, the Stop hook reminds it ("Working-docs gate: …"), and the guard won't open a PR or merge into `main` while the file exists.

```
/eng-kit:finish
```

The checks run once more, then, after a reviewer `Yes`, the agent pushes the work branch and opens the PR by default; merging locally, keeping the branch or deleting it is your choice. **Nothing is merged or pushed to `main` without you,** and any other push shows a confirmation dialog. The PR description links the task file at the last commit that had it (`blob/<sha>/docs/tasks/…`).

## Everyday work

| Situation | What to write |
|---|---|
| A bug | Describe it in words: "the total is wrong with a 15% discount". `systematic-debugging` loads: root cause → failing test → one fix |
| A small task | `/eng-kit:implement add validation: quantity > 0`. Bounded work stays in the chat, with no task file |
| You want to write up the task first | `/eng-kit:new-task …` → `docs/tasks/2026-09-27-….md` with only the description and numbered criteria, then `/eng-kit:implement docs/tasks/2026-09-27-….md` |
| Just run the checks | `/eng-kit:verify` |
| A big new feature | Again `brainstorming` → `writing-plans` → `implement` |
| Someone else's or an old repository | `/eng-kit:onboarding-existing-codebase`: repo map, proven commands, CLAUDE.md |
| A new project based on an old one | see the "A new project based on legacy" section below |
| A big project with several parts | see the "A big project: rewriting legacy in parts" section below |

## A new project based on legacy

Example: the old project `legacy-shop` becomes the new, improved `shop-v2`.

**1. A new project, with the old one read-only**
```bash
mkdir shop-v2 && cd shop-v2 && git init
claude --add-dir ../legacy-shop
```
Work happens in `shop-v2`, and `legacy-shop` is attached as a second folder so Claude can read it. Claude Code doesn't write outside the project without asking.

**2. Study the legacy without changing anything in it**
```
/eng-kit:onboarding-existing-codebase ../legacy-shop, read-only.
Don't write anything in legacy-shop; put the result in docs/legacy-map.md of this project.
```
The output is a map of the old code:
- the stack;
- the real commands, verified by running them;
- modules and the business rules in them;
- integrations;
- risky spots: money, migrations, areas without tests.

**3. Decide what to keep, what to improve, what to drop**
```
/eng-kit:brainstorming a new version of legacy-shop based on docs/legacy-map.md.
Keep the cart and discount behavior, improve the architecture and tests, remove the old admin panel.
```
The agent asks questions one at a time, and you choose the stack from the proposed options. Then it writes a task file whose description has three lists:
- **keep**: the legacy behavior as a contract;
- **improve**: what must change;
- **remove**: what gets dropped.

**4. Set up the new project's checks:** `/eng-kit:kit-init`.

**5. A plan in vertical slices**
```
/eng-kit:writing-plans docs/tasks/…-shop-v2.md
```
Each task is one feature moved over whole: "catalog", then "cart", then "discounts". For each feature **golden tests** are written: inputs and expected results are taken from the legacy system and act as acceptance tests of the new code, failing first like any test (test-standard, "Porting"). This proves the new code is no worse than the old, and intentional differences are recorded in the task file's Decisions.

**6. Move and verify**
```
/eng-kit:implement docs/tasks/…-shop-v2.md
/eng-kit:requesting-code-review
/eng-kit:finish
```

**The other way around:** if the old system must keep running in production while it's being replaced, you don't need a separate repository. Work directly in `legacy-shop` and replace it piece by piece (the strangler fig pattern, the same `changing-legacy-code` skill): new modules sit next to the old ones and take over their functions one by one.

## A big project: rewriting legacy in parts

One task file isn't enough for such a task. It becomes several independent tasks, each with its own short loop, chained through **Follow-ups**; no separate file tracks the parts. Example: rewrite `legacy-shop` into `shop-v2`.

**What runs by itself and what you call by hand.** In the terminal there's only `claude`; everything else happens inside the session.
- **Within one task, skills hand the work over by themselves** and stop at each gate, waiting for your "yes": brainstorming → (design approved) → writing-plans → (plan approved, inline or subagents chosen) → executing-plans → tests and verify gate → reviewer → finish (your choice).
- **Moving to the next task is your decision.** That's by design: after each task you look at the result.

**Phase 0. Map of the old code** (one session)
```bash
cd shop-v2 && claude --add-dir ../legacy-shop
```
```
/eng-kit:onboarding-existing-codebase ../legacy-shop, read-only, result in docs/legacy-map.md
```

**Phase 1. The first task and the Follow-ups** (one session)
```
/eng-kit:brainstorming rewrite legacy-shop based on docs/legacy-map.md. The project is big, split it into parts first
```
Brainstorming names the independent subsystems before refining any of them and proposes the split: the task to start now, and the rest one line each in its `## Follow-ups`, with order and the contracts between them (API, data, events). For example, the first task file `docs/tasks/…-foundation.md` gets:

```markdown
## Follow-ups

- Catalog: port product listing and search from legacy-shop; reads the schema from Foundation.
- Cart and discounts: after Catalog; the cart API contract from docs/legacy-map.md.
- Checkout and payment: after Cart; payments-and-money rules, idempotent payment calls.
- Admin panel: after Catalog, independent of Cart.
- Data migration and cutover from the old system: last, after all the others.
```

**Phases 2…N. One task = one task file = one branch = one PR, in a fresh session**

When a task finishes, the agent shows you its Follow-ups and offers to start the next one. You pick it:
```
/clear
/eng-kit:brainstorming Catalog, from the Foundation follow-ups. We port the behavior from legacy-shop
```
From there everything runs by itself: the task file with its description → plan → implementation with golden tests on legacy data → the file's lasting content moved into `docs/` and the file deleted → review of that last commit → `finish`. The Follow-ups that are still open move into the new task file, so the chain continues. Git keeps each deleted task file, and the PR links it.

**Final task: migration and cutover.** `payments-and-money` and `security-review` come in, and the guard asks before migrations and deploys.

**If the session was interrupted:** `claude --continue`, or a new session and the phrase "continue docs/tasks/…". The `## Progress` section shows which tasks of the plan are already done.

**Rules:**
- one task = one task file + one branch + one PR;
- split only at real seams: each task delivers value or a rollout step and is green on its own; never by size;
- `/clear` between tasks;
- "subagent per task" for plans with many independent tasks;
- don't start the next task until the current one has passed `finish`.

## Task file format

Every task file is written from the `templates/task.md` template. It stands in for a tracker issue: the sections before Plan are its description. Each section has an exact heading, answers one question and doesn't repeat the others. If there's nothing to write, the section says "None"; the section itself isn't removed.

| Section | The question it answers |
|---|---|
| Status / Base / Links | where the work stands, the commit the plan was written from, related issues and decisions |
| Original request | your words verbatim, collapsed |
| Intent | one sentence: who gets what and why |
| Context | up to three sentences: what exists now and what's wrong |
| Success criteria | a table "No. — observable criterion — how it's checked" |
| Scope | In scope / Out of scope |
| Decisions | decisions made with you; anything unconfirmed is marked **assumed** |
| Design | only what applies: components, contracts, data, errors, security |
| Rollout | migration, flags, cutover, rollback, or None |
| Risks and open questions | risks and questions; an open question blocks approval |
| Follow-ups | independent pieces left for later, one line each; shown to you when the task finishes |
| Plan | small tasks with `- [ ]` checkboxes, written by writing-plans |
| Progress | baseline, drift, rulings, `Task N: complete (…)`; no checkboxes; written by executing-plans |

**Before asking questions** the agent builds a context map: files, patterns, types, test conventions, unfinished work, standards, stack. Then it writes the intent, up to five assumptions and the open questions. After that it asks its questions one at a time.

**Size.** A description longer than about 300 lines or with more than 10 criteria usually hides several concerns. If they split at a seam, the rest goes to Follow-ups. A coherent change isn't cut to fit a size: it gets a longer plan and ordered commits.

**`Base:`** is the commit the plan was written from. Before execution the agent checks whether the plan's files have changed since then, and if they have, records the drift in Progress and re-checks the affected tasks.

## Task file statuses

Every task file has `Status:` on its second line. From it, both a new session and a colleague see right away what state the work is in.

| Status | Who sets it |
|---|---|
| `draft` | brainstorming (or `/eng-kit:new-task`) writes the description |
| `design approved (date)` | brainstorming, after your "yes" to the description; commits on the work branch |
| `plan approved (date)` | writing-plans, after your "yes" to the plan; commits again |
| `in progress` | executing-plans, when execution starts |

There is no final status: when the work is finished, what lasts moves into `docs/`, you see the Follow-ups, and the task file is deleted. A task file replaced by a new one is deleted in the same commit.

- **Only you approve.** Description and plan each need their own "yes"; the agent only records it.
- **No plan is written from a draft.** If the file is in `draft`, writing-plans asks you to approve the description first.
- **Anything approved must be in git.** A hook checks this: if a task file with status `design approved` or `plan approved` is uncommitted, the agent can't end its turn until it commits it (one reminder per prompt). On `main` it first asks for a work branch. The hook doesn't touch drafts and `in progress` files.
- **Anything implemented must be deleted.** A task file whose Plan has every checkbox ticked gets the same kind of reminder: move what lasts, show the Follow-ups, delete it.
- There is no "in review" status: `draft` already means "waiting for your review". Who changed the status and when is visible in the git history.

## Project documentation: what is created and by which command

| What | Where | Who creates it |
|---|---|---|
| Task files (description, plan, progress) | `docs/tasks/`, only on the work branch | `/eng-kit:brainstorming` or `/eng-kit:new-task`, then `/eng-kit:writing-plans`, `/eng-kit:implement` |
| Legacy map | `docs/legacy-map.md` | `/eng-kit:onboarding-existing-codebase` |
| CLAUDE.md | root | `/eng-kit:onboarding-existing-codebase` |
| **README, `docs/NN-topic.md` chapters and the `docs/README.md` index** | root, `docs/` | **`/eng-kit:docs`**: a documentation map; after your "yes" it writes everything from the code and the decision records |
| One chapter | `docs/NN-topic.md` | `/eng-kit:docs poll-engine` |
| CHANGELOG | `CHANGELOG.md` | `/eng-kit:docs changelog` (from git history) |
| Decision records | `docs/decisions/NNNN-slug.md` | `/eng-kit:docs decision <topic>`, and plan execution when a decision is made |

**From then on, documentation maintains itself.** Every plan in a task file has a Post-implementation block: which chapter to update and, for a new feature, which one to create. Plan execution does this in the same branch, a Docs line appears in the report, and the reviewer counts stale documentation as Important.

**Decision records are kept current, not piled up.** One topic per file, with a stable number for citations ("see decision 0007"). When a decision changes, its record is rewritten in place; when it no longer applies, it is deleted. There is no status or date: git keeps the history, and the agent reads only the rules that hold now.

**CLAUDE.md points the agent to the docs.** Its Docs section has the index, a "Task → Start with" table, and which source wins: code, tests and CI say what exists; decision records say which rules hold and why; topic docs describe. Rules for one area go into `.claude/rules/*.md` with `paths:` and load only for matching files.

**Example for a project that has code but no README:**

```
/eng-kit:docs
```

The agent proposes, for example:
- README;
- `docs/01-architecture.md`;
- `docs/02-poll-engine.md`;
- `docs/03-alfa-mqr-adapter.md`;
- `docs/04-strangler-routing.md`;
- CHANGELOG.

After "yes" it writes these documents and lists them in `docs/README.md`.

## What the guard stops

- `git push --force` and `git commit --no-verify`: denied immediately.
- a push other than the plain push of your work branch, deploys, migrations: it asks you first.
- Reading `.env`: denied, so secrets don't reach the model.
- Creating or merging a PR/MR, a merge or a push into `main` while a task file is in git, or committing a task file on `main`: denied until it's moved and deleted. A plain push of the work branch passes. In CI the `working-docs` job fails if `docs/tasks/*.md` is tracked.
- Everything else is decided by Claude Code's normal permissions.

## What to commit to the project

`CLAUDE.md`, `.claude/verify.json`, `.claude/guard.json`, `.claude/settings.json`, `.claude/rules/`, `docs/` (chapters, decision records). Task files are committed only on the work branch and deleted before it merges. Don't commit `.claude/settings.local.json`; personal notes go into the agent's memory, not the repo.

For a team, do one more thing: pin the plugin in the project, and colleagues get it automatically when they open the project.

```bash
claude plugin marketplace add rkaliev/eng-kit --scope project
claude plugin install eng-kit@eng-kit --scope project
```

## Cheat sheet

| Command | What for |
|---|---|
| `/eng-kit:brainstorming <idea>` | Design before code |
| `/eng-kit:kit-init` | Set up the project's checks, guard and deny rules |
| `/eng-kit:writing-plans <task file>` | A plan of small TDD tasks in the task file |
| `/eng-kit:implement <task file or phrase>` | Implementation with tests and a report; a task file with a Plan goes to executing-plans |
| `/eng-kit:systematic-debugging <symptom>` | Finding a bug's root cause |
| `/eng-kit:requesting-code-review` | Review by the `reviewer` agent |
| `/eng-kit:verify` | Run the checks |
| `/eng-kit:new-task <what to do>` | A task file with only the description and criteria |
| `/eng-kit:docs [topic \| changelog \| decision …]` | Project documentation: README, docs chapters, CHANGELOG, decision records |
| `/eng-kit:finish` | merge / PR / keep / discard |
| "watch CI" after push | CI through `gh pr checks --watch`: up to 2 attempts per failed check, then a question; the agent doesn't merge by itself |
| `/eng-kit:ci-quality-gates` | The project's CI: commands from verify.json, `gate`, secrets, audit, migrations, e2e without retries. `/eng-kit:kit-init` shows whether all the checks are in CI |
| "update dependency X" | `updating-dependencies`: one at a time, changelog read, major versions only with your "yes" |
