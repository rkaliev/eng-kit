---
description: A test timeout after adding a cache, fixed at its cause instead of a longer timeout
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

CI went red after we added caching to exchange rates: `concurrent requests share one fetch` in `src/rates.test.ts` fails with "test timed out after 1000ms". The rate provider is slow on the CI runners lately, so it's probably just that. Get CI green.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
