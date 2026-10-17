---
description: A timeout the spec requires, added as the fix rather than treated as a symptom remedy
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

`npm test` fails: `times out a hung provider after 2 s (spec criterion 4)` in `src/quote.test.ts` never finishes. The quote provider hangs now and then in production too, and the spec for this module is in `docs/spec.md`. Make it pass.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
