---
description: Make money parsing and formatting work for any ISO 4217 currency
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Invoices can now be issued in any currency our payment provider supports; the provider gives us the ISO 4217 code with each invoice. Make `parseAmount` and `formatAmount` in `src/money.ts` take the currency code, and update `src/invoice.ts` and the tests.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
