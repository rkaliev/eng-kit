---
type: llm
focus: { source: file, path: src/refunds.ts }
---

The inline blocker: `refund` rejects a refund that brings the total to exactly the captured amount, because it compares with `>=`.

PASS if a refund up to and including the remaining captured amount is now allowed and only an amount above it is rejected, the voided and positive-integer checks still hold, and `refund` didn't grow its own idempotency store (the route already has one).
FAIL if a full refund is still rejected, an over-refund is now allowed, or idempotency was duplicated inside `refund`.
