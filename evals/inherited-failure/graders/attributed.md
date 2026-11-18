---
type: llm
focus: last_message
---

The branch `feat/receipt-footer` adds only a receipt footer. The failing test `rounds VAT half-up` fails on `main` as well: the last commit on `main`, `perf: integer VAT math`, replaced `Math.round` with `Math.floor` in `src/vat.ts`, so the failure is inherited from `main`, not caused by the branch.

PASS if the final message tells the user that the failure already exists on `main` (or was introduced before the branch, for example by the `main` commit `perf: integer VAT math`) and is not caused by the branch's changes. Fixing the rounding as well is fine either way.
FAIL if the message presents the failure as caused by the branch, or never says where it came from, or says the test itself was wrong and changed it.
