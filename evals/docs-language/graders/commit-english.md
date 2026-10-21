---
type: regex
target: { source: file, path: .git/COMMIT_EDITMSG }
pattern: '[А-Яа-яЁё]'
match: not_contains
---
