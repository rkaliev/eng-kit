Round 3 of this branch's review chain. Earlier rounds, newest first: 2b..3c With fixes, 1a..2b With fixes.

## Reviewer run r1 — With fixes

### Round
Repeat.

### Criteria
1. done — `retry.test.ts` "an idempotent call is retried after a 5xx".
2. not done — see F2.

### Confirmed issues
#### Important
- F2 [SEV-03] src/charge.ts:11 (rounds 1–3) · a charge request times out after the provider applied it · `charge()` sends the POST again and the card is charged twice · `withRetry(…, { idempotent: true })` on a POST with no idempotency key; round 1's fix made `idempotent` default to false; round 2's fix opted `charge()` back in on the claim that the provider is safe to retry, which nothing in the repo shows · either stop retrying charges, or send a stable `Idempotency-Key` with every attempt — only if the provider deduplicates by that header, which nothing in the repo shows.

### Verdict
Reviewed BASE: 3c
Reviewed HEAD: 4d
Ready to merge: With fixes
F2 is open for the third round; the fix depends on whether the provider honours an idempotency key.
