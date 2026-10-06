---
name: finish
description: Verify, review and integrate the current branch (merge, PR, keep or discard)
disable-model-invocation: true
---

If the branch still carries a task file (`docs/tasks/`), finish it as in executing-plans (Finish, steps 1–2): the plan's Post-implementation docs, then move what lasts into docs/, show me its Follow-ups, and delete it in one commit. Rebase onto the base now if needed.

Then use the verification-before-completion skill on the current branch. If any check fails, stop and report it.

Then, unless the current HEAD already has a reviewer `Yes`, run requesting-code-review on this exact HEAD and repeat it after fixes until it does. A verdict covers only the commit it reviewed: any change after it (a commit, an amend, a rebase, a docs edit) needs a new review, and the review gate denies a PR or a merge into the base otherwise.

Then follow the finishing section of the git-workflow skill: with a reviewer `Yes` on HEAD, push the work branch and open the PR yourself, unless I asked to merge locally, keep or discard. Merging, keeping and discarding are my choice: wait for it, and never merge without me. After a push, offer to follow CI as described in git-workflow ("After a push").

In your final summary, include the branch's token use: run `node "<Kit root>/scripts/usage-log.ts"` (Kit root is in the session context) and quote its line.
