---
name: writing-skills
description: Use when creating a new skill or subagent, editing an existing skill, agent or prompt template, or checking that a skill actually changes agent behavior
---

# Writing skills

A skill is reusable know-how that the agent loads on demand: a technique, a discipline, or a domain reference. It is not a story about one task, and not something a linter or a script can enforce. Put mechanical rules in the guard or verify hooks, or in CI.

## Format (Agent Skills spec, as Claude Code loads it)

```
skills/<name>/SKILL.md        required
skills/<name>/references/*.md optional heavy reference, loaded only when needed
skills/<name>/scripts/*       optional tools; invoke as `node "${CLAUDE_SKILL_DIR}/scripts/x.ts"` (the exec bit can be lost)
```

```yaml
---
name: <name>            # = folder name; lowercase, digits, hyphens; ≤ 64 chars
description: Use when … # third person; triggers only; description + when_to_use are capped at 1,536 chars
---
```

Optional fields worth knowing:
- `disable-model-invocation: true`: only the user runs it (`/<name>`). Use it for entry points and side effects: deploys, commits, setup.
- `argument-hint` and `$ARGUMENTS`: for entry points that take a task or path.
- `effort: xhigh`: for skills whose value is careful reasoning (design, planning, debugging, security).
- `allowed-tools`: pre-approves tools while the skill runs. Keep it narrow; never grant broad `Bash`.
- `context: fork` with `agent: <type>`: runs the skill in an isolated subagent. Only for self-contained tasks that return a result.

Mechanical rules don't belong in a skill. Enforce them with a hook (the kit's guard and verify gate), a permission rule in `settings.json`, or CI.

## The description decides whether the skill fires

- Start with "Use when…" and list the situations and symptoms that should trigger it. Use the words a user or an error message would contain.
- **Do not summarize the process.** The agent will follow the summary instead of reading the body. A description saying "reviews between tasks" produced one review instead of the two the body required.
- Aim for under 300 characters. The descriptions of every installed skill share the context window.

## The body

- Stay under about 500 words; move heavy reference into `references/`. A loaded skill costs context for the rest of the session.
- Name *actions*, not harness tools ("load the skill", "dispatch a reviewer"), so the skill survives a tool rename.
- Start with the core principle; use an Iron Law only for real discipline rules.
- **Match the form to the failure:**
  - When agents skip steps under pressure, use a hard rule, a red-flags table of the rationalizations you observed, and an explicit closing of loopholes.
  - When they produce the wrong shape, use a positive template or example, not prohibitions (prohibitions can backfire).
- Give one excellent example rather than many mediocre ones. Refer to other skills by name ("REQUIRED: test-driven-development"), not by force-loading their files.
- Relative paths resolve against the skill directory.

## Subagents

An agent is a role with its own context, tools and report; write one when isolation is the point (review, search, narrower permissions). When to choose one, its format, the prompt rules and how to test it: `references/agents.md`.

## Test it like code

1. **RED:** run a realistic pressure scenario *without* the skill, using a subagent or a fresh session. Mix pressures: time, sunk cost, authority. End with "This is real. Choose and act." Record the agent's rationalizations verbatim.
2. **GREEN:** write the minimal skill that addresses those failures. Re-run the scenario and confirm the behavior changed.
3. **REFACTOR:** each new rationalization becomes an explicit counter. Re-run until it holds.

Also check that the description triggers: ask for the task in plain words and see whether the skill loads.

A change to a skill the eval suite covers is checked with `npm run eval -- --case <name>` against `docs/EVALS.md` (it costs plan usage). Before shipping, run `npm test` in this package (it lints frontmatter, names, word budgets and relative links) and `claude plugin validate .`. Then add what you changed and why to `docs/ARCHITECTURE.ru.md`.
