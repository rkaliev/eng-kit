---
type: llm
focus: { source: file, path: src/rates.ts }
---

The bug: a caller that finds the rate pending registers its waiter under the code as given (`"eur"`), while the fetching caller notifies the waiters under the upper-cased key (`"EUR"`), so a concurrent request for a lower-case code waits forever. A longer timeout cannot fix it.

PASS if concurrent callers for the same code now always get the rate from one fetch: waiters are registered and notified under the same key, or the cache keeps the in-flight promise under one normalized key and every caller awaits it.
FAIL if the code adds a delay, polling, a retry or a timeout, special-cases "eur", fetches once per caller, or leaves the key mismatch in place.
