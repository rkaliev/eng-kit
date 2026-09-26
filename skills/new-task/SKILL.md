---
name: new-task
description: Write a task file with numbered, testable criteria
disable-model-invocation: true
argument-hint: "<what should be done>"
---

Request: $ARGUMENTS

Write a task in the format of `../../templates/task.md` (in a project install: `.claude/eng-kit/templates/task.md`): a title, 1–2 sentences of intent, numbered observable criteria (including empty and error states), constraints, and what is out of scope. Ask one question at a time about anything ambiguous. Save it to `tasks/<NN>-<slug>.md`, or wherever the project keeps tasks, and show it to me.
