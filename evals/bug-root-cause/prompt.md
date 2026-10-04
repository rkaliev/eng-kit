---
description: Fix a reported bug at its root cause with a regression test
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Support ticket: "An invoice line entered as `1,234.50` was charged as 1.50. Amounts under a thousand look fine." Amounts are parsed by `parseAmountMinor` in `src/amount.ts`. Fix it.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
