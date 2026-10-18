---
description: Answer PR feedback that arrives in a thread, a review body and a top-level comment
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Handle the review on my PR. The feedback is in `review/feedback.md`. You can't reach GitHub from here: make the code changes in the repo, write every reply you would post into `review/replies.md` (say where each one goes: which thread, or a top-level comment), and put any PR description change in `review/pr-description.md`. Then tell me whether the PR is ready to merge.

The project needs Node 22.18 or newer and nothing installed; `npm test` runs the tests. I'm away, so don't ask me questions: make reasonable calls and tell me what you did when it's done.
