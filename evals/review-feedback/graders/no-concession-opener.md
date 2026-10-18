---
type: regex
target: { source: file, path: review/replies.md }
pattern: '^\s*(>\s*)?(\*\*)?(agreed|you.re right|good point|fair point|great catch|good catch|thanks)'
flags: 'im'
match: not_contains
---
