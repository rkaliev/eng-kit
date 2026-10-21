---
type: regex
target: { source: file, path: .git/COMMIT_EDITMSG }
pattern: '^initial\n?$'
match: not_contains
---
