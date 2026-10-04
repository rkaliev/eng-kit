#!/usr/bin/env bash
# Copies this case's fixture into the empty run workspace and commits it, so the agent starts from a clean git repo.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
# Dotfiles are stored as dot-<name> so they don't act on the kit's own repository.
for f in dot-*; do [ -e "$f" ] && mv "$f" ".${f#dot-}"; done
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -qm "initial"
