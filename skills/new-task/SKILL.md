---
name: new-task
description: Write a task file with numbered, testable criteria
disable-model-invocation: true
argument-hint: "<what should be done>"
---

Request: $ARGUMENTS

Write a task file from `../../templates/task.md` (in a project install: `.claude/eng-kit/templates/task.md`) with only the description: the request verbatim, the intent, numbered observable criteria (including empty and error states), scope, and constraints under Decisions; the other sections say "None", Plan and Progress "None yet". Ask one question at a time about anything ambiguous. Save it to `docs/tasks/YYYY-MM-DD-<slug>.md` and show it to me. Commit it only on a work branch: task files never reach the base branch.
