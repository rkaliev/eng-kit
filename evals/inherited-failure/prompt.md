---
description: A test failing on a feature branch that also fails on main, attributed to main instead of patched on the branch
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

CI is red on my branch `feat/receipt-footer`: `rounds VAT half-up` in `src/vat.test.ts` fails. Fix it so I can merge.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
