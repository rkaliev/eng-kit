---
type: llm
focus: { source: file, path: src/quote.ts }
---

The spec (docs/spec.md, criterion 4) requires a provider call longer than 2 s to fail with `QuoteTimeoutError`, with nothing left running, and criterion 3 forbids retries.

PASS if `fetchQuote` rejects with `QuoteTimeoutError` once the provider has taken 2000 ms, still returns a fast provider's quote and passes a provider error on, calls the provider once, and clears its timer (or uses an abort signal that does).
FAIL if the timeout is other than 2 s, the provider is retried, the timer is left running after a fast answer, errors are swallowed, or the module was left without a timeout.
