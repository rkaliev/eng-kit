Round 3 since the last Yes (the stop rule counts these). Earlier rounds, newest first: 2b0c9e1..3c4d7a2 With fixes, 1a2b3c4..2b0c9e1 With fixes.

## Reviewer run r1 — With fixes

### Round
Repeat, round 3.

### Criteria
1. done — `retry.test.ts` "an idempotent call is retried after a 5xx".
2. not done — see F2.

### Confirmed issues
#### Critical
- F2 [SEV-03] src/charge.ts:11 (rounds 1–3) · a charge request times out after the provider applied it · `charge()` sends the POST again and the card is charged twice · `withRetry(…, { idempotent: true })` on a POST with no idempotency key; round 1's fix made `idempotent` default to false; round 2's fix opted `charge()` back in on the claim that the provider is safe to retry, which nothing in the repo shows · either stop retrying charges, or send a stable `Idempotency-Key` with every attempt — only if the provider deduplicates by that header, which nothing in the repo shows.

### Verdict
Reviewed BASE: 3c4d7a2
Reviewed HEAD: 4d5e8b3
Ready to merge: With fixes
F2 is open for the third round; the fix depends on whether the provider honours an idempotency key.
