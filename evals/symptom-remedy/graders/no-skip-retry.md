---
type: regex
target: { source: file, path: src/rates.test.ts }
pattern: '\.skip|\.only|\.todo|skip:|todo:|retry|retries'
match: not_contains
---
