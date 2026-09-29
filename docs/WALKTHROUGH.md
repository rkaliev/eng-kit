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
4. **Choosing the stack is always your decision.** There will be 2–3 options (for example, TypeScript + Fastify, Kotlin + Spring, Go) with pros and cons and a recommendation. You choose.
5. **The spec** is written on a work branch to `docs/specs/2026-09-26-cart-api.md`, and the agent asks you to approve it. Specs and plans are working documents: they live only on the work branch and never reach `main`.

**Until you say "yes", no code is written.** This is a hard rule of the skill.

## Step 3. Scaffold and checks

After your "yes" the agent creates the scaffold with the stack's official tool: it pins versions and adds the test, lint and typecheck commands. Then:

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
/eng-kit:writing-plans docs/specs/2026-09-26-cart-api.md
```

The result is `docs/plans/2026-09-26-cart-api.md`: small tasks, each with the exact files and the tests that prove it's done. At the end of the plan there is a "Post-implementation" block: which documentation the change will make stale (README, docs, CHANGELOG, CLAUDE.md) and what to update in it. Then the agent asks how to execute and recommends one of the options:
- **inline**: in this same session, cheaper;
- **subagent per task**: a fresh `implementer` agent for each task plus a check by the `reviewer` agent; more expensive, but more reliable.

## Step 5. Implementation

```
/eng-kit:implement docs/plans/2026-09-26-cart-api.md
```

- **A separate branch:** the agent doesn't work on `main` without your consent.
- **Ledger:** the progress log `docs/plans/…progress.md`, on the same branch. If the context runs out or you close the session, the next session continues from the same place.
- **Test first in every task:** first a test that fails, then the code, then a green run.
- **If the agent wants to finish too early,** the hook sends it back: "Verify gate: files changed…". The agent runs the checks and only then reports.

The final report has the changed files, the commands with real results, each criterion and how it was checked, and what wasn't checked.

## Step 6. Review and finish

```
/eng-kit:requesting-code-review
```

The `reviewer` agent (opus, read-only) looks at the diff with fresh eyes and against the project's rules (CLAUDE.md, `.claude/rules/`, decision records). You get "Confirmed" issues with `file:line` and evidence, "Assumptions" and a verdict. The agent fixes Critical and Important.

Then the agent closes the working documents:
- behavior goes into the topic chapter, for example `docs/02-cart.md`;
- decisions and lasting rulings go into `docs/decisions/` (for example, "money in integer minor units");
- spec, plan and ledger are deleted in one commit, `docs: remove working docs for cart-api`. Git keeps them.

If the agent forgets, the Stop hook reminds it ("Working-docs gate: …"), and the guard won't open a PR or merge into `main` while they exist.

```
/eng-kit:finish
```

The checks run once more, then the choice: merge locally, push and PR, keep the branch or delete it. **Nothing is pushed without your choice.** On `git push` the guard shows a confirmation dialog. The PR description links the spec and plan at the last commit that had them.

## Everyday work

| Situation | What to write |
|---|---|
| A bug | Describe it in words: "the total is wrong with a 15% discount". `systematic-debugging` loads: root cause → failing test → one fix |
| A small task | `/eng-kit:implement add validation: quantity > 0` |
| You want to write up the task first | `/eng-kit:new-task …` → `tasks/01-….md` with numbered criteria, then `/eng-kit:implement tasks/01-….md` |
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
The agent asks questions one at a time, and you choose the stack from the proposed options. Then it writes a spec with three lists:
- **keep**: the legacy behavior as a contract;
- **improve**: what must change;
- **remove**: what gets dropped.

**4. Set up the new project's checks:** `/eng-kit:kit-init`.

**5. A plan in vertical slices**
```
/eng-kit:writing-plans docs/specs/…-shop-v2.md
```
Each task is one feature moved over whole: "catalog", then "cart", then "discounts". For each feature **golden tests** are written: inputs and expected results are taken from the legacy (the `changing-legacy-code` skill handles this). This proves the new code is no worse than the old, and intentional differences are recorded in the spec.

**6. Move and verify**
```
/eng-kit:implement docs/plans/…-shop-v2.md
/eng-kit:requesting-code-review
/eng-kit:finish
```

**The other way around:** if the old system must keep running in production while it's being replaced, you don't need a separate repository. Work directly in `legacy-shop` and replace it piece by piece (the strangler fig pattern, the same `changing-legacy-code` skill): new modules sit next to the old ones and take over their functions one by one.

## A big project: rewriting legacy in parts

One spec isn't enough for such a task. You need a **roadmap** and several short loops, one per part. Example: rewrite `legacy-shop` into `shop-v2`.

**What runs by itself and what you call by hand.** In the terminal there's only `claude`; everything else happens inside the session.
- **Within one part, skills hand the work over by themselves** and stop at each gate, waiting for your "yes": brainstorming → (spec approved) → writing-plans → (plan approved, inline or subagents chosen) → executing-plans → tests and verify gate → reviewer → finish (your choice).
- **Moving to the next part is your decision.** That's by design: after each part you look at the result.

**Phase 0. Map of the old code** (one session)
```bash
cd shop-v2 && claude --add-dir ../legacy-shop
```
```
/eng-kit:onboarding-existing-codebase ../legacy-shop, read-only, result in docs/legacy-map.md
```

**Phase 1. Roadmap** (one session)
```
/eng-kit:brainstorming rewrite legacy-shop based on docs/legacy-map.md. The project is big, split it into parts first
```
Brainstorming writes `docs/specs/…-roadmap.md` and asks you to approve it. The roadmap is the one working document that lives on the base branch, while it has open parts: it is the memory between parts and sessions. It contains:
- parts with checkboxes;
- order and dependencies;
- contracts between parts;
- a migration plan;
- open decisions.

For example:

| # | Part | Depends on |
|---|---|---|
| 1 | Foundation: stack, CI, DB schema, auth | — |
| 2 | Catalog | 1 |
| 3 | Cart and discounts | 2 |
| 4 | Checkout and payment | 3 |
| 5 | Admin panel | 2 |
| 6 | Data migration and cutover from the old system | all |

**Phases 2…N. One part = one loop = one fresh session**
```
/clear
/eng-kit:brainstorming part 2 "Catalog" from the roadmap. We port the behavior from legacy-shop
```
From there everything runs by itself: the part's spec → plan → implementation with golden tests on legacy data → review → working docs moved and deleted → `finish`. The part ticks its checkbox in the roadmap in its own branch; the last part deletes the roadmap. If you open a new session and say "let's continue the project", the agent reads the roadmap and takes the next unticked part.

**Final phase: migration and cutover.** This is a separate part: `payments-and-money` and `security-review` come in, and the guard asks before migrations and deploys.

**If the session was interrupted:** `claude --continue`, or a new session and the phrase "continue the plan docs/plans/…". The `*.progress.md` ledger shows which tasks are already done.

**Rules:**
- one part = one spec + one plan + one branch;
- parts are split only at real seams: each one delivers value or a rollout step and is green on its own;
- `/clear` between parts;
- "subagent per task" for parts with many independent tasks;
- don't start the next part until the current one has passed `finish`.

## Spec format

Every spec is written from the `templates/spec.md` template. Each section has an exact heading, answers one question and doesn't repeat the others. If there's nothing to write, the section says "None"; the section itself isn't removed.

| Section | The question it answers |
|---|---|
| Intent | one sentence: who gets what and why |
| Context | up to three sentences: what exists now and what's wrong |
| Success criteria | a table "No. — observable criterion — how it's checked" |
| Scope | In scope / Out of scope |
| Decisions | decisions made with you; anything unconfirmed is marked **assumed** |
| Design | only what applies: components, contracts, data, errors, security |
| Rollout | migration, flags, cutover, rollback, or None |
| Risks and open questions | risks and questions; an open question blocks approval |

**Before asking questions** the agent builds a context map: files, patterns, types, test conventions, unfinished work, standards, stack. Then it writes the intent, up to five assumptions and the open questions. After that it asks its questions one at a time.

**Size.** A spec longer than about 300 lines or with more than 10 criteria usually hides several concerns. If they split at a seam, they become parts of a roadmap. A coherent change isn't cut to fit a size: it gets a longer plan and ordered commits.

**The plan** keeps `Base:`, the commit it was written from. Before execution the agent checks whether the plan's files have changed since then, and if they have, re-checks the affected tasks.

## Spec and plan statuses

Every spec and every plan has `Status:` on its second line. From it, both a new session and a colleague see right away what state the document is in.

| Document | Statuses | Who changes it |
|---|---|---|
| Spec `docs/specs/…` | `draft` → `approved (date)` | brainstorming sets `draft`, and after your "yes" sets `approved` and commits on the work branch |
| Plan `docs/plans/…` | `draft` → `approved` → `in progress` | writing-plans and executing-plans |

There is no final status: when the work is finished, what lasts moves into `docs/`, and spec, plan and ledger are deleted. A spec replaced by a new one is deleted too.

- **Only you approve.** The agent doesn't set `approved` on its own; it only records your "yes".
- **No plan is written from a draft.** If the spec is in `draft`, writing-plans asks you to approve it first.
- **Anything approved must be in git.** A hook checks this: if a spec or plan with status `approved` is uncommitted, the agent can't end its turn until it commits them (one reminder per prompt). On `main` it first asks for a work branch. The hook doesn't touch drafts and `in progress` plans.
- **Anything implemented must be deleted.** A plan with every checkbox ticked, or a roadmap with no open part, gets the same kind of reminder: move what lasts and delete it.
- There is no "in review" status: `draft` already means "waiting for your review". Who changed the status and when is visible in the git history.

## Project documentation: what is created and by which command

| What | Where | Who creates it |
|---|---|---|
| Specs | `docs/specs/`, only on the work branch | `/eng-kit:brainstorming` |
| Roadmap | `docs/specs/…-roadmap.md`, on the base branch while it has open parts | `/eng-kit:brainstorming` |
| Plans and progress ledgers | `docs/plans/`, only on the work branch | `/eng-kit:writing-plans`, `/eng-kit:implement` |
| Legacy map | `docs/legacy-map.md` | `/eng-kit:onboarding-existing-codebase` |
| CLAUDE.md | root | `/eng-kit:onboarding-existing-codebase` |
| **README, `docs/NN-topic.md` chapters and the `docs/README.md` index** | root, `docs/` | **`/eng-kit:docs`**: a documentation map; after your "yes" it writes everything from the code and the decision records |
| One chapter | `docs/NN-topic.md` | `/eng-kit:docs poll-engine` |
| CHANGELOG | `CHANGELOG.md` | `/eng-kit:docs changelog` (from git history) |
| Decision records | `docs/decisions/NNNN-slug.md` | `/eng-kit:docs decision <topic>`, and plan execution when a decision is made |

**From then on, documentation maintains itself.** Every plan has a Post-implementation block: which chapter to update and, for a new feature, which one to create. Plan execution does this in the same branch, a Docs line appears in the report, and the reviewer counts stale documentation as Important.

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
- `git push`, deploys, migrations: it asks you first.
- Reading `.env`: denied, so secrets don't reach the model.
- A PR, a merge or a push into `main` while specs, plans or ledgers are in git: denied until they're moved and deleted. Pushing the work branch itself only asks.
- Everything else is decided by Claude Code's normal permissions.

## What to commit to the project

`CLAUDE.md`, `.claude/verify.json`, `.claude/guard.json`, `.claude/settings.json`, `.claude/rules/`, `docs/` (chapters, decision records, a roadmap with open parts). Specs, plans and ledgers are committed only on the work branch and deleted before it merges. Don't commit `.claude/settings.local.json`; personal notes go into the agent's memory, not the repo.

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
| `/eng-kit:writing-plans <spec>` | A plan of small TDD tasks |
| `/eng-kit:implement <task, plan or phrase>` | Implementation with tests and a report |
| `/eng-kit:systematic-debugging <symptom>` | Finding a bug's root cause |
| `/eng-kit:requesting-code-review` | Review by the `reviewer` agent |
| `/eng-kit:verify` | Run the checks |
| `/eng-kit:new-task <what to do>` | A task with criteria |
| `/eng-kit:docs [topic \| changelog \| decision …]` | Project documentation: README, docs chapters, CHANGELOG, decision records |
| `/eng-kit:finish` | merge / PR / keep / discard |
| "watch CI" after push | CI through `gh pr checks --watch`: up to 2 attempts per failed check, then a question; the agent doesn't merge by itself |
| `/eng-kit:ci-quality-gates` | The project's CI: commands from verify.json, `gate`, secrets, audit, migrations, e2e without retries. `/eng-kit:kit-init` shows whether all the checks are in CI |
| "update dependency X" | `updating-dependencies`: one at a time, changelog read, major versions only with your "yes" |
