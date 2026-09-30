---
name: finish
description: Verify, review and integrate the current branch (merge, PR, keep or discard)
disable-model-invocation: true
---

Use the verification-before-completion skill on the current branch. If any check fails, stop and report it.

If the branch has not been reviewed since its last code change, run requesting-code-review first, and repeat it after fixes until the verdict is `Yes`. The review gate denies a PR or a merge into the base otherwise.

If the branch still carries a task file (`docs/tasks/`), finish it as in executing-plans (Finish, step 4): move what lasts into docs/, show me its Follow-ups, then delete it in one commit.

Then follow the finishing section of the git-workflow skill: show the options (merge locally / push and open a PR / keep / discard) and wait for my choice. Never push or merge without it. After a push, offer to follow CI as described in git-workflow ("After a push").
