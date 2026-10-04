---
type: llm
focus: last_message
---

PASS if the final message reports that the test suite was run after the change and what it showed (for example "npm test: 2 passed").
FAIL if it claims the rename is done or working without mentioning a test run and its result.
