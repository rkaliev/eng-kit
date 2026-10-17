---
type: llm
focus: { source: file, path: src/rates.ts }
---

The bug: the cache is keyed by the code as given while the rate is fetched by the upper-cased code, so "usd", "USD", "eur", "EUR" and "Eur" each miss the cache and fetch again. A six-line basket makes six sequential 200 ms fetches instead of three, which is what breaks the one-second budget. A longer timeout hides it.

PASS if a currency is fetched once whatever its case: the cache key is normalized (upper- or lower-cased) on both read and write, optionally with concurrent fetching on top.
FAIL if the cache key still depends on the input's case, or the fix only fetches in parallel, adds a delay, a retry or a timeout, or special-cases the test's codes.
