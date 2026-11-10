# Database bootstrap, upgrade, and recovery

This runbook covers PostgreSQL initialization for the self-hosted Workforce
application. It does not authorize or describe access to any particular
development or production database. The database's actual schema and migration
ledger must be inspected before choosing a path.

## Migration tracks and compatibility

The active schema is `src/backend/db/schema.ts`. The authoritative migration
sequence is the six entries in `drizzle/meta/_journal.json`:

1. `0000_wild_agent_zero` creates the current Drizzle baseline.
2. `0001_notification_idempotency_expand` adds notification idempotency fields,
   their paired-nullability check, and a partial unique index.
3. `0002_retire_notification_legacy_indexes` removes two older notification
   resource-tuple indexes.
4. `0003_damp_unus` adds the audit actor type and constraint and permits system
   audit rows without a user actor.
5. `0004_application_history` replaces full application uniqueness with
   uniqueness for pending applications only.
6. `0005_assignment_history` replaces full assignment uniqueness with
   uniqueness for active assignments only.

`drizzle/0000_melodic_spectrum.sql` is not in the active journal. It has the same
initial tables and columns as `0000_wild_agent_zero.sql`; the only SQL
difference is that the journaled baseline creates two partial notification
indexes, which migration 0002 later drops. A database ledger entry for the
unjournaled file is not proof that the rest of the active sequence was applied.
Do not delete or rewrite that ledger entry to make the histories appear to
match.

`docs/history/database/supabase/001_initial_schema.sql` is a separate,
historical Supabase track, not a bootstrap option for the current app. Among
other differences, its profile IDs reference `auth.users`, it enables RLS and
defines Supabase-role policies, and its audit triggers call `auth.uid()`. The
current self-hosted schema instead stores `password_hash`, uses application
authorization rather than RLS, and records audit events through application
code. The initial Supabase application and assignment unique constraints also
do not match the current partial unique indexes. Do not run the current Drizzle
journal over a Supabase database.

The baseline uses `CREATE TABLE IF NOT EXISTS` and suppresses duplicate-object
errors for types and constraints; these statements do not reconcile a table,
enum, or constraint that exists with a different definition. Migrations 0004
and 0005 can fail if existing data contains duplicate pending applications or
duplicate active assignments. Migration 0001 is also not a general repair
migration for an arbitrary partially upgraded schema. There are no down
migrations.

## Fresh, empty database

Use this path only for a newly provisioned PostgreSQL database that is not
serving the application and has no user objects or migration ledger.

1. Provision the database and application role. Keep the application and
   background jobs stopped. Provide `DATABASE_URL` through the deployment
   secret mechanism; do not put credentials in source control or command-line
   history. `drizzle.config.ts` has a local `workforce` fallback when the
   variable is absent, so explicitly verify that `DATABASE_URL` is set.
2. Connect read-only and record the target identity before migration:

   ```sql
   SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
   SELECT schemaname, tablename
   FROM pg_catalog.pg_tables
   WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
   ORDER BY schemaname, tablename;
   SELECT to_regclass('drizzle.__drizzle_migrations') AS migration_ledger;
   ```

   The target must be the intended new database. Stop if it contains
   application tables, unexpected schemas, or a migration ledger. Do not use
   the fresh-install path to recover from a partially run migration.
3. From the checked-out release containing the journal and SQL files, run
   `npm exec -- drizzle-kit migrate` with that explicit `DATABASE_URL`. Do not
   use `drizzle-kit push`, hand-edit the journal, or run migrations at
   application startup.
4. Before starting the application, verify that
   `drizzle.__drizzle_migrations` contains all six journaled migrations and
   that the expected application tables, indexes, and constraints exist. Then
   run the release's database-backed smoke checks. Keep the database private
   and do not expose it to application traffic until initialization succeeds.

If a migration fails, preserve the error and ledger for diagnosis. Migrations
committed by earlier invocations remain applied. Do not drop schemas or volumes
to retry; classify the disposable/new database and use the recovery guidance
below.

## Existing database with data

There is no blanket command that safely upgrades an unidentified, populated
database. First classify it without changing it:

1. Stop application instances and scheduled/background jobs for the rehearsal.
   Record the database identity, PostgreSQL version, schema objects, enum
   labels, indexes, constraints, and every row in
   `drizzle.__drizzle_migrations`, if present. Compare these with the active
   journal and the applicable historical track. Ledger rows contain hashes and
   timestamps, not migration names: compare each SHA-256 SQL-file hash and
   journal `when` value in order, not just the row count. The current Drizzle
   migrator chooses pending SQL by the latest timestamp; it does not establish
   that old hashes or physical definitions match. Do not infer the database
   state from this repository's local test history.
2. Make a protected, encrypted, full backup before any migration attempt. Verify
   the backup by restoring it to a separate disposable PostgreSQL instance of a
   compatible version. Check that the restored schema and representative row
   counts match the source. Keep the original database untouched during this
   rehearsal.
3. Use the restored copy to check the exact preconditions. In particular,
   migrations 0004 and 0005 require no duplicate `(shift_id, employee_id)`
   pairs among pending applications and among assignments whose status is
   `assigned` or `confirmed`. Check the audit actor/nullability and notification
   idempotency columns and constraints against the migration that would add
   them. Resolve data conflicts explicitly before any production change; do
   not delete history to make a unique index succeed.
4. Run the current journal on the restored copy only when its ledger is a
   recognized prefix of the current Drizzle journal and the physical schema
   matches that prefix. Exercise the application against the upgraded copy and
   verify retained data, constraints, and migration ledger. If there is a
   `0000_melodic_spectrum` entry, an absent/inconsistent ledger, a Supabase
   schema, or any unexplained drift, stop. The repository does not yet provide
   an approved automatic conversion or baseline-adoption migration for those
   states; produce a separately reviewed, forward-only migration plan before
   proceeding.
5. Only after the restore and rehearsal succeed, schedule a maintenance window,
   take and verify a fresh backup, and repeat the rehearsed migration procedure
   against the intended database with the application still stopped. Verify
   the final ledger and schema before deploying/starting the matching app
   release.

The 2026-10-22 local Phase 5 record describes a local test database with the
current 0000–0003 entries and a retained unjournaled legacy entry. That was
left untouched and is not evidence about development or production databases.

## Failure recovery

The migration files have no down migrations. This version of Drizzle wraps all
pending SQL and ledger inserts in one transaction per migration invocation, so
a failure rolls that pending batch back. Migrations committed by previous
invocations remain applied and recorded; the ledger schema/table may already
have been created outside the failed transaction. Do not try to reverse the
schema by deleting ledger rows or manually recreating old indexes.

The recovery point is the verified pre-migration backup: restore it to a
separate database, validate it, and switch the application back only through a
planned database endpoint/restore procedure. Keep the failed target and logs
available for diagnosis; never overwrite the only backup or reset a persistent
volume as a rollback strategy. If the restored database cannot be validated,
keep the application offline and resolve the recovery before accepting writes.

## Disposable verification and limits

Run `npm run test:integration:safe` for the guarded, disposable PostgreSQL
verification. Its migration verifier checks the fresh six-migration journal,
the 0003-to-0004 and 0004-to-0005 data upgrades, uniqueness behavior, failed
migration transaction rollback, ledger preservation, and replay. The runner
asserts the unique temporary database identity and empty initial state.

For an actual synthetic backup-and-restore rehearsal, run:

```sh
npm run test:integration:safe -- --focus=employee-dashboard --recovery
```

After the guarded worker initializes the source through the active journal and
verifies empty fixture tables, the launcher rechecks ownership of its tmpfs-only
PostgreSQL container. It inserts synthetic records in all nine application
tables, takes a `pg_dump --format=custom --no-owner --no-acl` archive, creates a
separately named empty database from `template0`, and restores with
`pg_restore --no-owner --no-acl --exit-on-error --single-transaction`. Both
databases are in that uniquely owned disposable instance; no existing
development or production target is accepted. Schema/column definitions,
enums, indexes, constraints, all fixture row values and the migration ledger
are compared exactly. Restored constraints are exercised, and the source is
checked unchanged. Both databases and the temporary archive disappear with
the owned disposable container.

Delivery 9C verification (2026-11-09): this rehearsal passed with PostgreSQL 16.
All nine tables' fixture values, the schema catalogs and six-row migration
ledger matched after restore; source preservation and restored notification
uniqueness/audit-actor checks passed. The owned container, both temporary
databases and the archive were removed by the guarded cleanup.

For an operator-approved real backup, use the same PostgreSQL-major tools as
the source (the rehearsal uses PostgreSQL 16). Supply source/restore connection
settings through a protected PostgreSQL service/password file or secret
manager, not command-line credentials. For example, after target identity,
permissions, and emptiness have been checked:

```sh
pg_dump --dbname=service=approved_source --format=custom --no-owner --no-acl --file=/protected/backup/workforce.dump
pg_restore --dbname=service=approved_empty_restore --no-owner --no-acl --exit-on-error --single-transaction /protected/backup/workforce.dump
```

These are not commands to run against an unknown database. Encrypt the archive,
record its checksum and source/release identity, store an off-host protected
copy, and test that the operator can decrypt and restore it. Restore to a new
empty database, never over the source and never using `--clean` as a shortcut.
Because ownership/ACLs are intentionally excluded, separately provision and
verify the production roles/grants, provider settings and required extensions.
Verify **all** table counts, representative values and relationships, schema,
constraints/indexes and the ledger after restore; then run application smoke
checks against the copy. A provider snapshot/PITR procedure needs its own
restore rehearsal and recovery-time/data-loss objectives.

The disposable verification does not exercise a historical Supabase conversion,
an unidentified existing database, production role/ACL recreation, provider
backup encryption/storage or a real recovery endpoint switch. Those remain
operator- and database-specific checks; this runbook does not claim that any
existing database is ready to migrate.
