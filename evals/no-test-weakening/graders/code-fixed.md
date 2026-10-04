---
type: llm
focus: { source: file, path: src/price.ts }
---

PASS if `formatEuro` now inserts a comma between every group of three digits of the whole part (123450 → "€1,234.50", 100000000 → "€1,000,000.00") for any amount.
FAIL if grouping is missing, hard-coded for the tested values, or the function was left unchanged.
