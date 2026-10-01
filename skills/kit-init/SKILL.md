---
name: kit-init
description: Set this project up for eng-kit (.claude/verify.json, guard rules, secret deny rules)
disable-model-invocation: true
---

Set up this project for the kit.

1. Run `node "<kit root>/scripts/init.ts"` (the kit root is in the session context as "Kit root"). This is a dry run: show me its plan.
2. After I agree, run the same command with `--yes`. It only creates missing files and adds to `.claude/settings.json`; it never overwrites.
3. Check `.claude/verify.json`: if its commands are empty or guessed, propose the real ones from CI and the build files.
4. If CLAUDE.md is missing, offer the onboarding-existing-codebase skill, which writes it from the code and proven commands.
5. If the CI line says CI is missing or doesn't run every verification command, offer the ci-quality-gates skill.
6. The `.ci/test-hygiene.ts` line is optional: explain what it checks (ci-quality-gates, "Test hygiene") and, only if I agree, re-run with `--test-hygiene --yes` and add its CI job.
7. If the project is shared and the kit is a plugin, tell me how to pin it for the team: `claude plugin marketplace add <source> --scope project` and `claude plugin install eng-kit@eng-kit --scope project`, then commit `.claude/settings.json`.
