---
description: Compute money totals in integer minor units with explicit rounding
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Add `orderTotal(lines, vatPercent)` to `src/order.ts`: each line is `{ price: string, qty: number }` with prices like "19.99"; return the gross total including VAT as a string with two decimals, like "71.94". Add tests.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
