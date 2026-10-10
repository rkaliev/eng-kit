# accounts

User accounts service. PostgreSQL 16.

## Migrations

Plain SQL in `migrations/`: `NNN_name.up.sql` and `NNN_name.down.sql`, applied in order by the deploy pipeline before the new version of the service rolls out.

## Deploys

Rolling: instances of the previous version keep serving traffic until the rollout finishes, usually 10 to 15 minutes. Production `users` has about 4 million rows.
