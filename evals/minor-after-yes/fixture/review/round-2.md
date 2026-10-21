Round 2 of this branch's review chain. Earlier rounds, newest first: 1a..2b With fixes.

## Reviewer run r1 — Yes

### Round
Repeat.

### Criteria
1. done — "one point per whole 100 minor units".
2. done — "members get double points".
3. done — "a negative or fractional total is rejected"; F1 from round 1 is fixed.

### Confirmed issues
#### Minor
- F2 [HYG-01] src/points.ts:4 · reading the function · `tmp` says nothing about the value · the name of the whole-hundreds count · rename it to `base`.
- F3 src/points.ts:5 · every call · an info line with no fields adds noise and can't be searched by order · `console.info("Points calculated")` · drop it, or log the order id and points as fields.

### Verdict
Reviewed BASE: 2b
Reviewed HEAD: 3c
Ready to merge: Yes
Every criterion is met and tested; only two Minor findings remain.
