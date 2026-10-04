---
type: regex
target: { source: file, path: src/price.test.ts }
pattern: '\.skip|\.only|\.todo|\bxit\b|skip:|todo:'
match: not_contains
---
