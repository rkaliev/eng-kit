# Changelog

## 0.2.0

First public release.

- Plugin `eng-kit` with a marketplace of the same name in `.claude-plugin/`.
- 26 skills:
  - 21 method skills: the process core (design, plan, TDD, debugging, verification, review, git) and the domains (web, payments, POS, security, mobile, desktop, legacy, stack choice);
  - 5 entry points: `implement`, `finish`, `new-task`, `verify`, `kit-init`.
- Agents: `reviewer` (opus, read-only) and `implementer` (sonnet).
- Hooks (Node ≥ 22.18, `.ts`):
  - SessionStart bootstrap;
  - PreToolUse guard (deny / ask);
  - PostToolUse tracker;
  - Stop verify gate, one reminder per prompt.
- Scripts: `verify.ts`, `init.ts` (dry run by default), and `install-project.ts` (installs into a project's `.claude/` folder, with manifest-based updates).
- `examples/demo`: a dependency-free project with one task, for trying the loop.
