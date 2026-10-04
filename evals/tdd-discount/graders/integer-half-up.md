---
type: llm
focus: { source: file, path: src/discount.ts }
---

The spec: `applyPercentDiscount(totalMinor, percent)` returns the total minus a discount rounded half-up to a whole minor unit, using integer arithmetic only; 10% of 1999 gives 1799 and 15% of 1010 gives 858; a percent that is not an integer from 0 to 100, or a total that is not a non-negative integer, throws RangeError.

PASS if the code computes the discount with integer operations and throws RangeError for both kinds of invalid input. Integer division written as `Math.floor(a / b)` or `Math.trunc(a / b)` on integers counts as integer arithmetic, and so does splitting the total into hundreds and a remainder (for example `Math.floor((total * percent + 50) / 100)`, or `whole * percent + Math.floor((rest * percent + 50) / 100)`).
FAIL if the file is missing, the discount is rounded from a fractional value such as `Math.round(total * percent / 100)`, `total * (percent / 100)` or `toFixed`, the rounding is not half-up, or either RangeError check is missing.
