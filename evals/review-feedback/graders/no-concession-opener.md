---
type: regex
target: { source: file, path: review/replies.md }
pattern: '^[ \t]*(>[ \t]*)?(([-*]|\d+[.)])[ \t]+)?(\*\*)?((good|great|nice) (catch|point)|thanks|thank you|you.re absolutely right|(agreed|you.re right|fair point)(?![^\n]*\b(fixed|now uses|changed|added)\b))'
flags: 'im'
match: not_contains
---
