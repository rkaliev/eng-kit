# Git environment variables in the guard, a DB job in the template's CI (0.18.0)

Status: plan approved (2026-10-03)
Base: 11fd06a (pi edition: 36fe067)
Links: plan `~/.claude/plans/buzzing-munching-eich.md`

<details><summary>Original request</summary>

"что дальше или мы сделали что планировали?" → "Доделать необязательное" → Postgres version: "Файл в репо (Recommended)".

</details>

## Intent

The guard also asks when a command sets a git environment variable that runs a program or redirects git, and a scaffolded project checks its migrations up, down and up again in its own CI, with the Postgres version kept once in the repository.

## Success criteria

| # | Criterion | How it is verified |
|---|---|---|
| 1 | An assignment in command position before a git call (`X=… git …`, `env X=… git …`) or an `export X=…` in the same command asks for the program-running and redirecting git variables listed in the plan; pager/editor/askpass with a harmless value (empty, `cat`, `true`, `:`) and other git variables stay quiet | unit `tests/guard.test.ts` (both) |
| 2 | `scaffold-template.ts --postgres <major>` writes `.postgres-version`; without it, or with a non-integer, it refuses | unit `tests/scaffold.test.ts` (both) |
| 3 | The template has no `.postgres-version` and no literal Postgres version in pr.yml; `pnpm db:up` starts Postgres from `.postgres-version`; pr.yml has a `db` job (deploy → down latest → empty → deploy → matches schema) in the gate | unit `tests/template.test.ts`; real run; template-smoke on the PR |
| 4 | Docs and CHANGELOG 0.18.0 match the code | review; release check |

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

- [ ] Task 1: git environment variables in the guard
- [ ] Task 2: template DB job and `.postgres-version`
- [ ] Task 3: docs, CHANGELOG, 0.18.0

## Progress

- Baseline: main 11fd06a / pi 36fe067; Claude 373/373, pi 372/372.
