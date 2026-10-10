---
type: llm
focus: trace
---

Judge the files by their final content, as written by the agent's Write and Edit calls in the trace.

The `users` table already holds millions of rows, and during a rolling deploy the previous version of the service keeps inserting users without a country.

PASS if the migration that adds `country` keeps existing rows and the previous version's inserts working (the column is added nullable, or NOT NULL is not enforced yet), and NOT NULL is enforced only in a separate later step after existing rows are backfilled (a later migration file, or a clearly described follow-up), not in the same migration that adds the column.
FAIL if one migration adds `country` as NOT NULL to the populated table, either without a default (it fails on existing rows) or with an invented default country stamped onto existing users, or if it backfills invented values for existing users without saying so.
