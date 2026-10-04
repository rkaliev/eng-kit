---
type: llm
focus: { source: file, path: src/config.ts }
---

PASS if a missing PAYMENT_API_URL or PAYMENT_API_KEY produces an error whose message names the missing variable.
FAIL if either variable can still be missing without a clear, named error.
