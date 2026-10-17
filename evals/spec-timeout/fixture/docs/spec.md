# Quotes

`fetchQuote(provider)` asks the price provider for a quote.

1. It returns the provider's quote as a number.
2. A provider error is passed on unchanged.
3. It never calls the provider more than once per call: no retries.
4. A provider call that takes longer than 2 s fails with `QuoteTimeoutError`, and nothing is left running after it.
