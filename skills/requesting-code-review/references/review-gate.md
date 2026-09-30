# Review gate

The guard denies opening or merging a PR/MR, merging into the base branch and pushing to it unless the kit reviewer's last verdict is `Yes` for the commit being landed. The hook records the verdict from the reviewer's own `Reviewed HEAD:` and `Ready to merge:` lines when the reviewer finishes; you never write it yourself.

- A review covers the branch's own change to reviewable files, not one SHA. Deleting task files, changing `docs/` or other markdown, and rebasing onto a newer base keep it valid. Any other change needs a new review, including markdown that steers the agent: CLAUDE.md, AGENTS.md, SKILL.md and anything under `.claude/`, `rules/`, `skills/`, `agents/` or `prompts/`. The list is fixed; the project can't widen it.
- Land in a command of its own: a landing chained after `git commit`, `switch` or another HEAD move is refused, because the guard can't see the commit it would land. `gh pr merge <number>` asks, because the PR's head isn't known locally; name the branch, or merge from it.
- If the reviewer's report lacks the two verdict lines, the hook sends it back once to add them.
- `With fixes`, `No` and `Inconclusive` all block: fix, then re-review the new range.
- Parallel reviewers dispatched for one user prompt combine to the worst verdict. A finding you pushed back on without changing code is withdrawn by a re-review in a later prompt, after the user has seen your reasoning.
- A branch that changes only exempt files needs no review. Only the user can waive the gate (`"reviewGate": false` in `.claude/guard.json`, whose edits the guard asks about). A self-review in a separate pass does not satisfy the gate.
