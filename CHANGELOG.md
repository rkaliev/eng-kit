# Changelog

## 0.2.3

- `brainstorming` writes a roadmap (`docs/specs/…-roadmap.md`) when a request splits into several subsystems: pieces, order, contracts, migration, open decisions. Each piece then gets its own cycle and is ticked off when finished.
- `using-skills` resumes a large project from its roadmap.

## 0.2.2

- `brainstorming` and the reviewer prompt name platform and domain skills consistently.

## 0.2.1

- Clearer description of the scope (platform, domain, new or existing code) and of the skill groups: process, starting point, platforms, high-risk domains.
- `using-skills` routes platform work and high-risk domain work to their skills separately.

## 0.2.0

First public release.

- Plugin `eng-kit` with a marketplace of the same name in `.claude-plugin/`.
- 26 skills:
  - 21 method skills: process core (design, plan, TDD, debugging, verification, review, git), starting point (stack choice, onboarding, legacy code), platforms (web, mobile, desktop) and high-risk domains (payments, POS, security);
  - 5 entry points: `implement`, `finish`, `new-task`, `verify`, `kit-init`.
- Agents: `reviewer` (opus, read-only) and `implementer` (sonnet).
- Hooks (Node ≥ 22.18, `.ts`):
  - SessionStart bootstrap;
  - PreToolUse guard (deny / ask);
  - PostToolUse tracker;
  - Stop verify gate, one reminder per prompt.
- Scripts: `verify.ts`, `init.ts` (dry run by default), and `install-project.ts` (installs into a project's `.claude/` folder, with manifest-based updates).
- `examples/demo`: a dependency-free project with one task, for trying the loop.
