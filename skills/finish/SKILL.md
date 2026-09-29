---
name: finish
description: Verify, review and integrate the current branch (merge, PR, keep or discard)
disable-model-invocation: true
---

Use the verification-before-completion skill on the current branch. If any check fails, stop and report it.

If the branch has not been reviewed since its last change, run requesting-code-review first.

If the branch still carries working documents (`docs/specs/`, `docs/plans/`; a roadmap with open pieces may stay), finish them as in executing-plans (Finish, step 4): move what lasts into docs/, then delete them in one commit.

Then follow the finishing section of the git-workflow skill: show the options (merge locally / push and open a PR / keep / discard) and wait for my choice. Never push or merge without it. After a push, offer to follow CI as described in git-workflow ("After a push").
