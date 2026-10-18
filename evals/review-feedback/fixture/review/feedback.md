# PR #42 "Add partial refunds" — feedback so far

Your branch head is `a1b2c3d`. All CI checks were green on it 10 minutes ago, except the required `e2e` check, which hasn't reported yet.

## Inline thread on `src/refunds.ts`, the `>=` comparison (review-bot)

> Blocking: a refund that brings the total to exactly the captured amount is rejected. Refunding a payment in full must work; only amounts above the captured total should fail.

## Review body (review-bot, state: CHANGES_REQUESTED, no threads attached)

> 1. (Blocking) Refunds are not idempotent: `refund()` never looks at an Idempotency-Key, so a retried POST refunds twice.
> 2. (Nit) Error messages mix "Refund …" and "refund …" capitalisation.
> 3. (Important) No test covers a refund on a voided payment.

## Top-level comment (dana, a teammate)

> Can you mention in the PR description that this needs the `refunds_v2` flag on?
