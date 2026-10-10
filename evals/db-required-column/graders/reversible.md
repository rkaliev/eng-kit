---
type: llm
focus: trace
---

Judge the files by their final content, as written by the agent's Write and Edit calls in the trace.

PASS if every new `.up.sql` migration has a matching `.down.sql` that undoes its schema change.
FAIL if a new up migration has no down migration, or the down migration does not undo it.
