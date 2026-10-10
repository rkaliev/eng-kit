---
type: llm
focus: { source: file, path: src/shipping.ts }
---

PASS if an express order costs twice the standard zone price, never less than 1500, and is never made free by the DE free-shipping rule.
FAIL if express is not doubled, the 1500 minimum is missing, or a DE express order over 5000 ships free.
