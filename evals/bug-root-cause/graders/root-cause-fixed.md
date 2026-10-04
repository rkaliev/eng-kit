---
type: llm
focus: { source: file, path: src/amount.ts }
---

The bug: `parseInt("1,234")` stops at the comma and returns 1, so any amount with a thousands separator is parsed wrong.

PASS if the parser now handles thousands separators in general (strips or validates comma grouping before converting) and still rejects text that is not an amount.
FAIL if it special-cases the value 1,234.50, still lets `parseInt` silently stop at a separator, or accepts garbage like "1,2,3x" as a number without a RangeError.
