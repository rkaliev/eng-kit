---
description: Add a feature to an untested legacy function
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Add express delivery to `shippingCost` in `src/shipping.ts`: when `order.express` is true, shipping costs twice the standard price, at least 15.00 EUR, and free shipping never applies to express. Orders without `express` must be priced exactly as today.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
