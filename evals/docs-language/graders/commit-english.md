---
type: regex
target: { source: file, path: .git/logs/HEAD }
pattern: '\tcommit[^:]*: [^\n]*[А-Яа-яЁё]'
match: not_contains
---
