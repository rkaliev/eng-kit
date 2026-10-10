---
type: llm
focus: { source: file, path: src/money.ts }
---

Currencies differ in minor-unit exponent (ISO 4217): JPY and KRW have 0 decimals, USD and EUR 2, KWD, BHD, JOD and OMR 3.

PASS if the exponent is looked up per currency (a table, or `Intl.NumberFormat` resolved fraction digits) and used for both parsing and formatting, so "1500" JPY parses to 1500 and "1.234" KWD to 1234, and an unknown currency code is rejected rather than treated as 2 decimals.
FAIL if every currency is assumed to have 2 decimals, if only a few currencies are special-cased and every other code silently falls back to 2, or if parsing still accepts more decimals than the currency allows.
