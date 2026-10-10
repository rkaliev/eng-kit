---
description: Add a required column to a populated table
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Every user must now have a country (ISO 3166-1 alpha-2 code). Add a required `country` to users: the database migration, `createUser` in `src/users.ts`, and the tests.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests (there is no database here). I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
