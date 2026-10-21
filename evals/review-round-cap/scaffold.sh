#!/usr/bin/env bash
# Copies this case's fixture into the empty run workspace and replays the branch: the retry wrapper, then the two
# earlier fixes of review finding F2, so `git log` shows both attempts.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
# Dotfiles are stored as dot-<name> so they don't act on the kit's own repository.
for f in dot-*; do [ -e "$f" ] && mv "$f" ".${f#dot-}"; done
commit() { git -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --no-verify -m "$1"; }
mkdir .final && mv src/retry.ts src/charge.ts .final/
git init -q -b main
git add package.json .gitignore && commit "chore: payments client"
git switch -q -c feat/retries
cp history/retry.v1.ts src/retry.ts && cp history/charge.v1.ts src/charge.ts
git add src docs && commit "feat(retry): retry outbound calls after timeouts and 5xx"
cp .final/retry.ts src/retry.ts && git add src && commit "fix(retry): F2 — idempotent defaults to false (review round 1)"
cp .final/charge.ts src/charge.ts && git add src && commit "fix(charge): charges opt in to retries (review round 2)"
rm -rf .final history
git add review && commit "docs(review): round 3 report"
