#!/usr/bin/env bash
# Copies this case's fixture into the empty run workspace and commits it on a work branch, so the agent starts
# from a clean git repo with the review report in place.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
# Dotfiles are stored as dot-<name> so they don't act on the kit's own repository.
for f in dot-*; do [ -e "$f" ] && mv "$f" ".${f#dot-}"; done
commit() { git -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --no-verify -m "$1"; }
git init -q -b main
git add package.json .gitignore && commit "chore: loyalty service"
git switch -q -c feat/points
git add src docs && commit "feat(points): loyalty points per order"
git add review && commit "docs(review): round 2 report"
