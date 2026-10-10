---
type: llm
focus: { source: file, path: src/shipping.ts }
---

PASS if, for orders without `express`, the function still returns exactly what the original did: the same zone prices, weight rounding, the free-shipping rule with a strict `> 5000`, and coupon halving with `Math.round`; express pricing is added without changing those paths.
FAIL if any non-express result changes, for example the free-shipping boundary becomes `>=`, the coupon rounding changes, or unrelated logic is "fixed" or rewritten in a way that changes results.
