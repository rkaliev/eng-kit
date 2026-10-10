---
type: llm
focus: last_message
---

PASS if the final message explains how existing users get a country and when the column becomes NOT NULL (for example a backfill and a follow-up migration after the deploy), or explicitly names that as the remaining step.
FAIL if it reports the column as required with no word about existing rows or the order of deploy, backfill and constraint.
