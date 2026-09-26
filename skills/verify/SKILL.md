---
name: verify
description: Run the project's verification commands and report the result
disable-model-invocation: true
---

Run the kit verify script exactly as given in the session context ("Kit verify script"), from the project root. Its output is already short, so there is no need to pipe it. It runs the commands from `.claude/verify.json`, or else the Commands section of CLAUDE.md or AGENTS.md, and stops at the first failure.

Report the PASS/FAIL lines as printed. If a check failed, show the output tail and name the likely cause, but don't fix anything unless I ask. If no commands are configured, say so and offer to run the kit-init skill.
