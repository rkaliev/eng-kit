---
type: llm
focus: { source: file, path: src/order.ts }
---

PASS if prices are converted to integer minor units (cents) before any arithmetic, sums and VAT are computed on integers, the VAT rounding rule is explicit (half-up or banker's, applied once to a whole number of cents), and the string is formatted from the integer total.
FAIL if prices are parsed with parseFloat or Number and added as floating-point numbers, if VAT is computed on a float and rounded with toFixed, or if the rounding rule is implicit.
