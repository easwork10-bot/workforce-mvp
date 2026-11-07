import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Called only by the worker after verifying its disposable database is empty.
export async function verifyApplicationHistoryUpgrade(connectionString, projectRoot) {
  const client = new pg.Client({ connectionString });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workforce-upgrade-test-'));
  const source = path.join(projectRoot, 'drizzle');
  const journal = JSON.parse(await readFile(path.join(source, 'meta', '_journal.json'), 'utf8'));
  const profileIds = Array.from({ length: 4 }, () => randomUUID());
  const shiftId = randomUUID();
  const applicationIds = profileIds.map(() => randomUUID());
  const assignmentId = randomUUID();
  const statuses = ['rejected', 'cancelled', 'accepted', 'pending'];

  async function catalog() {
    const indexes = await client.query(`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename, indexname
    `);
    const constraints = await client.query(`
      SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      ORDER BY table_name, conname
    `);
    return { indexes: indexes.rows, constraints: constraints.rows };
  }

  async function fixtures() {
    const result = {};
    for (const table of ['profiles', 'shifts', 'shift_applications', 'shift_assignments', 'attendance_records']) {
      result[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    }
    return result;
  }

  try {
    await client.connect();
    assert.equal((await client.query(`
      SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
    `)).rows[0].count, 0, 'Upgrade verification requires the verified-empty disposable database');
    await cp(source, directory, { recursive: true });
    const journalFile = path.join(directory, 'meta', '_journal.json');
    const database = drizzle(client);
    await migrate(database, { migrationsFolder: directory });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, journal.entries.length);
    const freshCatalog = await catalog();
    assert.ok(freshCatalog.indexes.some(index => index.indexname === 'unique_active_shift_assignment_employee'));
    console.log('Fresh full journaled migration chain: passed.');
    // Only schemas just created in the verified-empty disposable database are reset.
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE');
    await writeFile(journalFile, JSON.stringify({
      ...journal, entries: journal.entries.filter((entry) => entry.idx <= 3),
    }));
    await migrate(database, { migrationsFolder: directory });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, 4);

    for (const id of profileIds) {
      await client.query('INSERT INTO profiles (id, full_name, email) VALUES ($1, $2, $3)',
        [id, 'Migration fixture', `migration-${id}@workforce.test`]);
    }
    await client.query(`
      INSERT INTO shifts (id, title, work_type, location, start_at, end_at, required_workers, created_by, status)
      VALUES ($1, 'Migration fixture', 'traffic', 'Amsterdam', '2099-01-01 09:00Z', '2099-01-01 17:00Z', 4, $2, 'open')
    `, [shiftId, profileIds[0]]);
    for (const [index, employeeId] of profileIds.entries()) {
      await client.query(`
        INSERT INTO shift_applications (id, shift_id, employee_id, status, reviewed_by, reviewed_at, rejection_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        applicationIds[index], shiftId, employeeId, statuses[index],
        index < 3 ? profileIds[0] : null,
        index < 3 ? new Date('2026-01-01T09:00:00Z') : null,
        index === 0 ? 'Synthetic fixture reason' : null,
      ]);
    }
    await client.query(`
      INSERT INTO shift_assignments (id, shift_id, employee_id, application_id, assigned_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [assignmentId, shiftId, profileIds[2], applicationIds[2], profileIds[0]]);
    const originalFixtures = await fixtures();
    const originalCatalog = await catalog();

    await writeFile(journalFile, JSON.stringify({
      ...journal, entries: journal.entries.filter((entry) => entry.idx <= 4),
    }));
    const migrationFile = path.join(directory, '0004_application_history.sql');
    const migrationSql = await readFile(migrationFile, 'utf8');
    await writeFile(migrationFile, `${migrationSql}
--> statement-breakpoint
SELECT * FROM deliberately_missing_upgrade_test_relation;
`);
    await assert.rejects(migrate(database, { migrationsFolder: directory }), { code: '42P01' });
    assert.deepEqual(await fixtures(), originalFixtures);
    assert.deepEqual(await catalog(), originalCatalog);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, 4, 'Failed migration must not advance the journal ledger');
    console.log('Upgrade failure rollback: passed (data, indexes, constraints and ledger preserved).');

    await writeFile(migrationFile, migrationSql);
    await migrate(database, { migrationsFolder: directory });
    assert.deepEqual(await fixtures(), originalFixtures);
    const upgradedCatalog = await catalog();
    assert.deepEqual(upgradedCatalog.constraints, originalCatalog.constraints);
    assert.deepEqual(
      upgradedCatalog.indexes.filter((index) => index.indexname !== 'unique_pending_shift_employee'),
      originalCatalog.indexes.filter((index) => index.indexname !== 'unique_shift_employee'),
    );
    const pendingIndex = upgradedCatalog.indexes.find((index) => index.indexname === 'unique_pending_shift_employee');
    assert.ok(pendingIndex?.indexdef.includes("status = 'pending'"));
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, 5);

    for (const employeeId of profileIds.slice(0, 3)) {
      for (const status of ['rejected', 'cancelled', 'accepted', 'pending']) {
        await client.query('INSERT INTO shift_applications (shift_id, employee_id, status) VALUES ($1, $2, $3)',
          [shiftId, employeeId, status]);
      }
      await assert.rejects(client.query(`
        INSERT INTO shift_applications (shift_id, employee_id, status) VALUES ($1, $2, 'pending')
      `, [shiftId, employeeId]), { code: '23505', constraint: 'unique_pending_shift_employee' });
    }
    await assert.rejects(client.query(`
      INSERT INTO shift_applications (shift_id, employee_id, status) VALUES ($1, $2, 'pending')
    `, [shiftId, profileIds[3]]), { code: '23505', constraint: 'unique_pending_shift_employee' });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM shift_applications')).rows[0].count, 16);
    await migrate(database, { migrationsFolder: directory });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, 5, 'Migration replay must not add ledger rows');
    console.log('0003 → 0004 upgrade: passed (history, pending uniqueness, assignments and unrelated constraints).');

    const assignmentStatuses = ['cancelled', 'completed', 'assigned', 'confirmed'];
    await client.query('UPDATE shift_assignments SET status = $1 WHERE id = $2', ['assigned', assignmentId]);
    for (const index of [0, 1, 3]) {
      await client.query(`
        INSERT INTO shift_assignments (shift_id, employee_id, application_id, assigned_by, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [shiftId, profileIds[index], applicationIds[index], profileIds[0], assignmentStatuses[index]]);
    }
    await client.query(`
      INSERT INTO attendance_records (shift_assignment_id, check_in_at, attendance_status)
      VALUES ($1, '2026-01-01 09:00Z', 'checked_in')
    `, [assignmentId]);
    const beforeAssignments = await fixtures();
    const beforeAssignmentCatalog = await catalog();
    assert.equal((await client.query(`
      SELECT count(*)::int AS count FROM pg_constraint WHERE conname = 'unique_shift_assignment_employee'
    `)).rows[0].count, 0, 'Legacy assignment uniqueness is an index, not a table constraint');
    await writeFile(journalFile, JSON.stringify(journal));
    const assignmentFile = path.join(directory, '0005_assignment_history.sql');
    const assignmentSql = await readFile(assignmentFile, 'utf8');
    await writeFile(assignmentFile, `${assignmentSql}
--> statement-breakpoint
SELECT * FROM deliberately_missing_assignment_upgrade_relation;
`);
    await assert.rejects(migrate(database, { migrationsFolder: directory }), { code: '42P01' });
    assert.deepEqual(await fixtures(), beforeAssignments);
    assert.deepEqual(await catalog(), beforeAssignmentCatalog);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, 5);
    await writeFile(assignmentFile, assignmentSql);
    await migrate(database, { migrationsFolder: directory });
    assert.deepEqual(await fixtures(), beforeAssignments);
    const afterAssignmentCatalog = await catalog();
    assert.deepEqual(afterAssignmentCatalog.constraints, beforeAssignmentCatalog.constraints);
    assert.deepEqual(
      afterAssignmentCatalog.indexes.filter(index => index.indexname !== 'unique_active_shift_assignment_employee'),
      beforeAssignmentCatalog.indexes.filter(index => index.indexname !== 'unique_shift_assignment_employee'),
    );
    assert.deepEqual(afterAssignmentCatalog, freshCatalog);
    for (const employeeId of profileIds) {
      for (const status of ['cancelled', 'completed']) {
        await client.query(`
          INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status) VALUES ($1, $2, $3, $4)
        `, [shiftId, employeeId, profileIds[0], status]);
      }
      if (employeeId === profileIds[0] || employeeId === profileIds[1]) {
        await client.query(`
          INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status) VALUES ($1, $2, $3, 'assigned')
        `, [shiftId, employeeId, profileIds[0]]);
      }
      for (const status of ['assigned', 'confirmed']) {
        await assert.rejects(client.query(`
          INSERT INTO shift_assignments (shift_id, employee_id, assigned_by, status) VALUES ($1, $2, $3, $4)
        `, [shiftId, employeeId, profileIds[0], status]),
        { code: '23505', constraint: 'unique_active_shift_assignment_employee' });
      }
    }
    await migrate(database, { migrationsFolder: directory });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
      .rows[0].count, journal.entries.length);
    console.log('0004 → 0005 upgrade and failed-migration rollback: passed (history, attendance, active uniqueness, constraints).');
    await client.query('DELETE FROM attendance_records WHERE shift_assignment_id IN (SELECT id FROM shift_assignments WHERE shift_id = $1)', [shiftId]);
    await client.query('DELETE FROM shift_assignments WHERE shift_id = $1', [shiftId]);
    await client.query('DELETE FROM shifts WHERE id = $1', [shiftId]);
    await client.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [profileIds]);
  } finally {
    await client.end();
    await rm(directory, { recursive: true, force: true });
  }
}
