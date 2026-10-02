# A proven TypeScript full-stack profile, a monorepo template and the practices behind them

Status: in progress
Base: f45fc281a1145b5d9ea58086bc978feeddfe1e0b (pi edition: b9046d894f199221c1586565d9cb2411416fa689)
Links: study of a production TypeScript monorepo (private FRAMEWORK-SOURCES, new §11.18) · plan `~/.claude/plans/buzzing-munching-eich.md`

<details><summary>Original request</summary>

"изучи тот стек что использует fortune-os, в чем его сильные стороны и в чем слабые, давай возьмем там лучшее и подумаем в какой развилке он может быть полезен" → form: "профиль кандидат нравится, а так же формат их монорепы и в целом что там ипользуется, условно 1 + 3 вариант" · practices: monorepo CI, one Postgres, mechanical boundaries, dependency discipline · kit-init: "Да, с тестом" · versions: set at scaffold · template size: working skeleton · execution: subagent per task · kit CI: "Да, раз в неделю + на PR".

</details>

## Intent

When a new TypeScript web product or SaaS is started, the agent can offer a stack already proven in production as one candidate. If that candidate is picked, a working monorepo comes from the kit with current pinned versions. The practices that made that stack reliable also apply in every project.

## Context

`choosing-a-stack` has only a defaults table. No skill covers pnpm workspaces, Turbo, affected-only CI, Postgres as the only store or mechanically enforced boundaries. `detectVerifyCommands` (`lib/init.ts:152`) does not recognise a Turbo monorepo.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | Asked to pick a stack for "a SaaS web product in TypeScript, one team, Postgres", the agent offers the profile as one of 2–3 candidates and asks the user. It never presents the profile as the default, and it checks versions at the source | writing-skills RED/GREEN, a subagent without and with the change |
| 2 | Every role in `references/ts-fullstack-profile.md` gives a choice, the reason, when not to take it and an alternative. The file contains no version numbers | unit `tests/template.test.ts` (no `\d+\.\d+` versions in the profile); review checklist for the role format |
| 3 | The template holds no versions: no `package.json` in it has `dependencies`/`devDependencies`/`packageManager`; `scaffold.json` lists bare package names only, for workspaces that exist; every `uses:` in its workflow ends in `@<sha>` | unit `tests/template.test.ts` |
| 4 | `node scripts/scaffold-template.ts <dir>` copies the template, writes `.nvmrc` and `packageManager` from the running Node and pnpm, and installs `scaffold.json` with `pnpm add -E`; the result passes `pnpm turbo run typecheck lint test`, and `prisma migrate deploy` succeeds against Postgres. It refuses a non-empty `<dir>` | unit `tests/scaffold.test.ts` (copy, refusal, the install commands it plans, with installs stubbed); workflow `template-smoke` (weekly and on PRs touching the template or the script) runs it for real; one run by hand in this task, output in Progress |
| 5 | In the template, an import from server code or `@repo/db` inside `apps/web/src/client` fails `lint` | manual, in the same scaffold run as #4 (add the import → `pnpm turbo run lint` fails → remove it) |
| 6 | `detectVerifyCommands`: with `turbo.json` it returns one `<exec> turbo run <tasks>` built from the tasks it declares, in the order typecheck/type-check, lint, test. `<exec>` is `pnpm`, `yarn`, `bunx` or `npx` from the lockfile or `pnpm-workspace.yaml`. `turbo.json` or `turbo.jsonc` may hold comments; a key `pkg#task` declares `task`. A manifest's Commands still win; without Turbo the only change is that `pnpm-workspace.yaml` alone selects pnpm | unit `tests/init.test.ts` in both editions |
| 7 | The four practices are in the skills, stack-free: ci-quality-gates (affected-only, falls back to everything, cache written only from main, one gate); backend-services and database-changes (Postgres for queue, cache and locks until a measurement shows a separate service is needed); web-frontend (client/server boundary enforced by lint, build and a bundle check); updating-dependencies (every override and patch has a reason and a removal condition, release-age delay, no `@latest` in tool configs, one source of the runtime version) | review checklist; `tests/lint-skills.test.ts` stays green |
| 8 | Both editions match: `tools/compare-editions.mts` reports no new drift; `diff -r` of the two templates differs only in the manifest name | commands run in Progress |

## Scope

**In scope:**
- Both editions:
  - `skills/choosing-a-stack/SKILL.md` and a new `references/ts-fullstack-profile.md`;
  - new `templates/ts-monorepo/`;
  - the skills in criterion 7 and `references/ci-templates.md`;
  - `lib/init.ts` (pi: `extensions/lib/init.ts`) and `tests/init.test.ts`;
  - new `tests/template.test.ts`;
  - new `scripts/scaffold-template.ts` with `tests/scaffold.test.ts`, and `.github/workflows/template-smoke.yml`;
  - `docs/ARCHITECTURE*.md`, `CHANGELOG.md`, version 0.15.0.
- Workspace: `docs/FRAMEWORK-SOURCES.ru.md` §11.18 and the memory note.

**Out of scope:**
- Prisma down-migrations, tRPC, TanStack Start, Tailwind/shadcn, BDD and custom lint rules in the template: they are in the profile as options.
- A per-package CI matrix: the skill describes it as the next step when one job gets slow.
- Making the profile a default.

## Decisions

1. The profile is one candidate in the fork "new TypeScript web or SaaS product, one team, Postgres". It is not a default: for a financial core the kit stays on JVM/.NET. POS hardware, mobile and small infra services are outside it (user, 2026-10-02).
2. The template holds no versions. They are installed at scaffold with `pnpm add -E`, the latest stable release with an exact pin. Node LTS and action SHAs are checked at their source (user).
3. The template is a working skeleton (user): `apps/web` (React + Vite), `apps/api` (Express 5), `packages/db` (Prisma schema and migrations, Kysely queries), shared presets, Postgres-only compose, CI.
4. **assumed:** the API uses Express 5, as the source's main application does. Hono is the alternative in the profile.
5. **assumed:** template CI is a single job running `turbo run … --affected`, with everything run on main and a Turbo cache restored on PRs and saved only on main. The source's per-package matrix is the documented next step.
6. **assumed:** the Kysely types come from the `prisma-kysely` generator, as in the source. The profile lists `kysely-codegen` as the alternative because of the single-maintainer risk. If the real scaffold fails on it, the plan stops and the user is asked.
7. The source's weaknesses become "when not to take it" and warnings in the profile: version drift, beta versions in production, patches and overrides without an exit, `@latest`, heavy local infrastructure, vendor lock-in and 4-byte cents. Coverage stays on the kit rule (ci-quality-gates: reported per change, floor on a schedule, never blocks a merge); the source does the same, so it is not a warning (user, 2026-10-02). The kit's money rule stays stricter than the source.
8. Detection: a manifest's Commands win, then `turbo.json`, then root `package.json` scripts. Root scripts in a Turbo repo only delegate, so one `turbo run` shares the task graph. `build` is left out of the verify command because CI builds; it stays in CI.
9. One script, `scripts/scaffold-template.ts`, runs the scaffold for the agent and for CI, so the steps exist once. Choosing the Node LTS and pinning action SHAs stay with the agent: the script takes the running Node and pnpm as given (user chose kit CI weekly and on PRs, 2026-10-02).
10. `template-smoke` does not block the kit's `gate` or release: red means the ecosystem moved and the template needs a fix.
11. 0.x in a key role only as a named exception with its reason in the decision record; Kysely is that exception in the profile (user, 2026-10-02).

## Design

**Profile** (`skills/choosing-a-stack/references/ts-fullstack-profile.md`):
- When it fits and when not to take it.
- One row per role: choice, why, when not, alternative. The roles are monorepo, runtime, language, web, API, contracts, data, migrations, tests, quality, observability and dependencies.
- Selection filter: no beta and no 0.x for key roles, no vendor SaaS by default.
- Warnings, taken from the source's weaknesses.
- Scaffold steps:
  1. check the current Node LTS at nodejs.org and that `node` runs it; install the latest pnpm (pnpm.io/installation; Node 25+ no longer bundles corepack) and check `pnpm --version`;
  2. `node <kit>/scripts/scaffold-template.ts <dir>`;
  3. pin each `@<sha>` in the workflow to the action's latest release commit;
  4. `pnpm turbo run typecheck lint test`;
  5. a decision record with the installed versions.
- No version numbers anywhere in it.

**Template** (`templates/ts-monorepo/`):
- Root: `package.json` (scripts through turbo, no dependencies), `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `saveExact`, a release-age delay), `turbo.json` (typecheck/lint/test/build, strict env), `.gitignore`, `.env.example`, `docker-compose.yml` (postgres only), the manifest (`CLAUDE.md`, or `AGENTS.md` in pi) with Stack and Commands, and `.github/workflows/pr.yml`.
- `packages/typescript-config`: `base.json` (strict, `noUncheckedIndexedAccess`), `node.json`, `vite.json`.
- `packages/eslint-config`: a flat config plus `client` boundaries (`no-restricted-imports` of `@repo/db`, `node:*` and server paths).
- `packages/prettier-config`.
- `packages/db`: `prisma/schema.prisma`, `prisma.config.ts`, `src/pool.ts` with a pure `poolConfig(env)` that sets `statement_timeout` and `lock_timeout`, a test.
- `apps/api`: `src/config.ts` (parsed once, fails fast; no default for secrets), `src/app.ts` (`/healthz`, `/readyz`), `src/main.ts` (SIGTERM drains), tests.
- `apps/web`: Vite, `src/client/` and `src/domain/`, a domain test.
- `scaffold.json`: `{ "<workspace>": { "dependencies": [names], "devDependencies": [names] } }`.

**Init:** `detectVerifyCommands` gains a Turbo branch before the `package.json` scripts. `turbo.json` `tasks` (or legacy `pipeline`) keys are filtered to typecheck/type-check, lint and test.

## Rollout

None: new files and text. Projects that ran kit-init before keep their `verify.json`.

## Risks and open questions

- Prisma 7 with the `prisma-kysely` generator may not combine → criterion 4 catches it; Decision 6.
- The template drifts from the current majors (for example ESLint or Vite config formats) → it holds no versions, and nightly CI is a Follow-up.
- `template-smoke` turns red on an upstream release → it is not part of `gate`; whoever sees it fixes the template.

## Follow-ups

- Two-way migrations (`down.sql`) and a migration-markers check in the template.
- `ciCoverage` (`lib/ci.ts`) matches commands by exact text, so a Turbo CI that runs the same tasks in another order or form is reported as a gap.
- Per-package CI matrix, `turbo query affected`, when one job gets slow.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** add the TS full-stack profile, the `ts-monorepo` template, the four practices and Turbo detection to both editions.
**Architecture:** text in skills and references, a static template folder checked by a unit test, and one new branch in `detectVerifyCommands`. The Claude edition is written first; pi gets the same files, with `AGENTS.md`/`.pi` paths.
**Stack / constraints:** kit Node ≥ 22.18, `node --test`, TypeScript 5.9.3 as in `package.json`, no new kit dependencies. Template: no versions (criterion 3). English, kit voice: short imperative lines.
**Verification:** `node --test tests/*.test.ts` and `npx tsc --noEmit` in each edition (the kit verify script).

### Review focus
1. `turbo.json` that is unreadable or has no matching tasks → fall through to the `package.json` scripts (test in Task 1).
2. `pnpm-workspace.yaml` without a lockfile (a fresh scaffold) → pnpm (Task 1).
3. A template `package.json` that sneaks in a version through `packageManager` or `engines` (Task 3 test).
4. The profile drifting into a default by wording ("use", "default") → RED/GREEN in Task 2.
5. The client boundary rule missing deep relative imports into the server folder → manual check in Task 4.

### Post-implementation
- `docs/ARCHITECTURE.md` and `.ru.md` (both editions): the skills section gains the profile and template; how kit-init detects Turbo.
- `CHANGELOG.md` 0.15.0 and the version in `package.json` and `.claude-plugin/*` (pi: `package.json`).
- Workspace `docs/FRAMEWORK-SOURCES.ru.md` §11.18: what was taken and what was not, the reasons, the user's decisions.
- Memory `fortune-os-study`.
- README: none, because it lists skills, not references. Check this in Task 6.

### Task 1: Turbo detection in kit-init

**Files:** Modify `src_claude/lib/init.ts`, `src/extensions/lib/init.ts` · Test `src_claude/tests/init.test.ts`, `src/tests/init.test.ts`

- [x] Write test `then from turbo.json tasks, as one turbo run`:
  - `{turbo.json: {"tasks":{"build":{},"lint":{},"test":{},"typecheck":{}}}, pnpm-workspace.yaml: "", package.json: scripts({test:"turbo run test"})}` → `["pnpm turbo run typecheck lint test"]`;
  - with `package-lock.json` → `["npx turbo run typecheck lint test"]`;
  - legacy `{"pipeline":{"test":{}}}` with `yarn.lock` → `["yarn turbo run test"]`;
  - `turbo.json` = `"{"` with scripts `{test:"vitest run"}` → `["npm test"]`;
  - `{"tasks":{"build":{}}}` with scripts `{test:"vitest run"}` → `["npm test"]`.
- [x] Run `node --test tests/init.test.ts` → expect FAIL: actual `["pnpm test"]`, expected `["pnpm turbo run typecheck lint test"]`.
- [x] Implement in `detectVerifyCommands`:
  - pm: pnpm when `pnpm-lock.yaml` or `pnpm-workspace.yaml` exists;
  - exec map: `{pnpm:"pnpm", yarn:"yarn", bun:"bunx", npm:"npx"}`;
  - a Turbo branch after the manifest check and before the package.json scripts, which reads `tasks ?? pipeline` and ignores a parse failure.
- [x] Run the full suite → PASS. Repeat the test and the code in pi (`src/`), run its suite → PASS.
- [x] Commit `feat(init): detect turbo monorepos` in each repo.

### Task 2: Profile and choosing-a-stack

**Files:** Create `skills/choosing-a-stack/references/ts-fullstack-profile.md` · Modify `skills/choosing-a-stack/SKILL.md` (both editions)

- [ ] RED: a fresh subagent with the current skill text gets "Pick a stack for a new B2B SaaS web product in TypeScript, one team of 4, Postgres, EU hosting." Record the candidates, whether it asks, and whether it checks versions.
- [ ] Write the profile per the Design: roles table, filter, warnings, scaffold steps, no versions.
- [ ] Add a row note to the "Web frontend" and "Backend / API" defaults: "TypeScript full-stack in one repo: the profile in `references/ts-fullstack-profile.md` is one candidate". Add a line to step 5: scaffold that candidate by the profile's steps.
- [ ] GREEN: the same prompt with the new text → the profile appears as one of 2–3 candidates, the subagent asks, and versions are marked "check at the source". The gap is recorded in Progress.
- [ ] Copy to pi; `node tools/compare-editions.mts` from the workspace shows no new drift.
- [ ] Commit `feat(choosing-a-stack): typescript full-stack profile`.

### Task 3: Template and its unit test

**Files:** Create `templates/ts-monorepo/**` (Design list) · Test `tests/template.test.ts` (both editions)

- [ ] Write `tests/template.test.ts`:
  - `template package.json files hold no versions`: no `dependencies`, `devDependencies`, `peerDependencies` or `packageManager` key, and `engines` absent;
  - `scaffold.json names existing workspaces and bare packages`: each key is a folder with a `package.json`, and each name matches `^(@[a-z0-9-]+/)?[a-z0-9.-]+$`;
  - `workflow actions are pinned at scaffold`: every `uses:` line ends in `@<sha>`;
  - `the profile states no versions`: no `/\b\d+\.\d+(\.\d+)?\b/` in `ts-fullstack-profile.md`.
- [ ] Run it → expect FAIL: `templates/ts-monorepo/scaffold.json` missing (assertion on `existsSync`, not a thrown error).
- [ ] Write the template files per the Design (Claude: `CLAUDE.md`; pi: `AGENTS.md`).
- [ ] Run the full suite → PASS; `npx tsc --noEmit` → PASS (the template is outside `include`).
- [ ] Copy to pi with the manifest renamed; `diff -r` shows only the manifest name.
- [ ] Commit `feat(templates): ts-monorepo skeleton`.

### Task 4: Scaffold script, smoke workflow, real run (criteria 4 and 5)

**Files:** Create `scripts/scaffold-template.ts`, `lib/scaffold.ts` (pi: `extensions/lib/scaffold.ts`), `.github/workflows/template-smoke.yml` · Test `tests/scaffold.test.ts` (both editions)
**Interfaces:** Produces `planScaffold(template: string, dest: string, versions: { node: string; pnpm: string }): { copy: string[]; writes: Record<string,string>; installs: string[][] }` and `scaffold(template, dest, run = spawnSync)`.

- [ ] Write tests:
  - `refuses a non-empty destination`: `scaffold` throws `Destination is not empty: <dest>`;
  - `plans installs from scaffold.json`: `{ "apps/api": { "dependencies": ["express"], "devDependencies": ["vitest"] } }` gives `[["pnpm","--filter","./apps/api","add","-E","express"],["pnpm","--filter","./apps/api","add","-E","-D","vitest"]]`; empty lists are skipped;
  - `writes .nvmrc and packageManager`: `.nvmrc` = `24.1.0\n` and root `packageManager` = `pnpm@10.0.0` for those inputs;
  - stub `planScaffold` returns empty → FAIL on the assertions.
- [ ] Implement `lib/scaffold.ts` and the CLI (`scripts/scaffold-template.ts <dest>`; versions from `process.versions.node` and `pnpm --version`; `pnpm install` after the root write, then the planned installs; a failing command exits non-zero with its output). Run the suite → PASS.
- [ ] Write `template-smoke.yml`:
  - triggers: `schedule` weekly, `workflow_dispatch`, and `pull_request` paths `templates/ts-monorepo/**`, `scripts/scaffold-template.ts`, `lib/scaffold.ts`;
  - a `postgres` service;
  - setup-node `lts/*` and corepack pnpm;
  - steps: scaffold into `$RUNNER_TEMP/app`, `pnpm turbo run typecheck lint test`, `prisma migrate deploy` with `DATABASE_URL` pointing at the service;
  - actions pinned by SHA like `ci.yml`. It is not in `gate`.
- [ ] Run the script by hand into the scratchpad.
- [ ] `pnpm turbo run typecheck lint test` → all green.
- [ ] `docker compose up -d postgres`, `pnpm --filter @repo/db exec prisma migrate deploy` → success; then `docker compose down`.
- [ ] Add `import "@repo/db"` and `import "../../../api/src/app"` to `apps/web/src/client/main.tsx` → `lint` fails on both; revert.
- [ ] Every fix found goes back into the template (both editions) and re-runs Task 3's test. Record the output and the installed versions in Progress.
- [ ] Copy the script, lib, test and workflow to pi; run its suite → PASS.
- [ ] Commit `feat(templates): scaffold script and weekly template smoke` (plus `fix(templates): …` if any).

### Task 5: Practices in the skills

**Files:** Modify `skills/ci-quality-gates/SKILL.md` and `references/ci-templates.md`, `skills/backend-services/SKILL.md`, `skills/database-changes/SKILL.md`, `skills/web-frontend/SKILL.md`, `skills/updating-dependencies/SKILL.md` (both editions)

- [ ] ci-templates: a "Monorepo" section.
  - Covers `turbo run … --affected` (or the tool's equivalent) with `fetch-depth: 0`, everything on main, the cache restored on PRs and saved only from main, one `gate`.
  - Gives a per-package matrix once one job gets slow, falling back to everything on error.
  - The SKILL.md gets one line pointing there.
- [ ] backend-services: "one store until measured".
  - Queue (`FOR UPDATE SKIP LOCKED`), cache and advisory locks in the existing Postgres.
  - A separate broker or cache only after a measurement or a hard need, recorded in a decision record.
  - database-changes gets one line on statement/lock timeouts per pooled connection, unless it is already there (check first).
- [ ] web-frontend: client/server and server-only libraries enforced mechanically by a lint import rule, a build-time import guard and a check that a server-only marker is absent from the bundle.
- [ ] updating-dependencies:
  - every override or patch carries a reason and a removal condition;
  - a release-age delay for new versions, with exceptions listed;
  - no `@latest`/unpinned tools in MCP and tool configs;
  - one source for the runtime version, with derived pins checked.
- [ ] `node --test tests/lint-skills.test.ts` → PASS. Copy to pi; compare-editions shows no new drift.
- [ ] Commit `feat(skills): monorepo ci, one store, enforced boundaries, dependency discipline`.

### Task 6: Docs and release

**Files:** Modify `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE.ru.md`, `CHANGELOG.md`, `package.json`, plugin manifests (both editions) · workspace `docs/FRAMEWORK-SOURCES.ru.md`

- [ ] Update the docs per Post-implementation and set the version to 0.15.0.
- [ ] Run `node .github/release.ts check` in each repo → PASS.
- [ ] Run the full verify in both editions → PASS.
- [ ] Commit `docs: 0.15.0 typescript profile and template`.
- [ ] Finish order (git-workflow): delete the task file, rebase, verify, reviewer last.

## Progress

- Baseline (2026-10-02): src_claude `npm test` 307/307, `tsc --noEmit` ok; pi `npm test` 308/308, `tsc --noEmit` ok. No drift since Base (branch just created from origin/main).
- Pre-flight: Task 4 consumes the template from Task 3 and `scaffold.json`'s shape from the Design; no conflicts.
- Task 2 RED (2026-10-02, current skill text, B2B SaaS prompt): asked the user, no versions quoted (sources named), 3 candidates assembled from scratch (NestJS+Vite SPAs, Next.js, Fastify+React Router); proposed pnpm workspaces with "Turborepo only if needed", Drizzle-leaning ORM, scaffold "with each project's official generator". Gap: no production-proven integrated candidate, no one-store/boundary/schema-vs-query rules, no ready template.
- Task 1 RED: new test failed with actual `["npm test"]` vs expected `["pnpm turbo run typecheck lint test"]` (the plan predicted `["pnpm test"]`; detection ignored `pnpm-workspace.yaml`). Edge-case round: the comment case failed with `[]` vs `["npx turbo run lint"]` before the fix.
- Ruling: `pnpm-workspace.yaml` alone selects pnpm also without Turbo — npm cannot install a pnpm workspace — cost if wrong: a repo with a stray workspace file gets pnpm commands. Criterion 6 reworded.
- Ruling (review Minor 3–4): JSONC (`turbo.json`/`turbo.jsonc` with comments) and `pkg#task` keys count; trailing commas still fall through to the scripts.
- Task 1: complete (f45fc28..acf5cbd; pi b9046d8..b3f1618; `npm test` 309/309 Claude, 310/310 pi, `tsc --noEmit` clean; review round 2 Yes on acf5cbd).
- Task 2 GREEN (same prompt, new text): profile offered as candidate A of three (with Next.js and NestJS), user asked to choose, no versions (sources named), scaffold via the kit script. Gap: it called A "the reliable default for exactly this shape" → a sentence forbidding "default/recommended stack" wording added in the review fixes.
- Task 2 review round 1 (With fixes): empty Not-when/Alternative cells, `Express 5`, 0.x filter vs Kysely, coverage warning vs ci-quality-gates, Migrations row vs database-changes, plus Minor. User ruled on 0.x (Decision 11) and coverage (Decision 7).
- Ruling: `corepack use` replaced by installing pnpm per pnpm.io — Node 25+ ships without corepack, and `corepack use` writes into the nearest package.json — cost if wrong: one extra install step.
- Task 2 GREEN re-run on f6f9756: three candidates (profile as A, Next.js, NestJS), "On what you've told me, I lean towards A … this is your call", no "default" wording, no versions (sources listed), 0.x exceptions named for the decision record. Criterion 1 holds.
- Task 2 review round 2 (With fixes): Minor wording (generators' 0.x claim, down migrations via `prisma migrate diff`, dialect warning, Tests/Dependencies cells) fixed in f6f9756 / pi eaed207; tRPC router types exported from a package with its own tsconfig.
