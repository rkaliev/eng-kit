---
type: llm
focus: trace
---

PASS if the agent wrote tests for the existing (non-express) behavior of `shippingCost` and ran them against the original code before it changed `src/shipping.ts`.
FAIL if `src/shipping.ts` was changed before any test of its existing behavior existed and had been run, or if no such tests were written.
