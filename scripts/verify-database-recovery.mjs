import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Only called with the launcher's ownership-checked, tmpfs-only PostgreSQL container.
export async function verifyDatabaseRecovery(exec) {
  const source = 'workforce_test';
  const target = `workforce_restore_${randomBytes(12).toString('hex')}`;
  const dump = `/tmp/${target}.dump`;
  const tables = [
    'profiles', 'user_roles', 'employee_details', 'shifts', 'shift_applications',
    'shift_assignments', 'attendance_records', 'notifications', 'audit_logs',
  ];
  async function sql(database, text) {
    const result = await exec([
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'workforce_test', '-d', database,
      '-At', '-c', text,
    ]);
    return result.stdout.trim();
  }
  async function snapshot(database) {
    const result = {};
    for (const table of [...tables, 'drizzle.__drizzle_migrations']) {
      result[table] = JSON.parse(await sql(database,
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${table === 'employee_details' ? 'profile_id' : 'id'}), '[]'::jsonb) FROM ${table} t`));
    }
    for (const [name, query] of Object.entries({
      columns: `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema IN ('public', 'drizzle')
        ORDER BY table_schema, table_name, ordinal_position`,
      indexes: `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, tablename, indexname`,
      constraints: `SELECT conrelid::regclass::text AS relation, conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE connamespace IN ('public'::regnamespace, 'drizzle'::regnamespace)
        ORDER BY relation, conname`,
      enums: `SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
        ORDER BY t.typname, e.enumsortorder`,
    })) {
      result[name] = JSON.parse(await sql(database, `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (${query}) t`));
    }
    return result;
  }
  assert.equal(await sql(source, 'SELECT current_database()'), source);
  for (const table of tables) {
    assert.equal(await sql(source, `SELECT count(*) FROM ${table}`), '0', 'Recovery rehearsal requires empty fixture tables');
  }
  assert.equal(await sql(source, 'SELECT count(*) FROM drizzle.__drizzle_migrations'), '6');
  assert.equal(await sql(source, `SELECT count(*) FROM pg_database WHERE datname = '${target}'`), '0');

  // Synthetic records only, covering every application table and cross-table relationships.
  await sql(source, `
    BEGIN;
    INSERT INTO profiles (id, full_name, email) VALUES
      ('10000000-0000-4000-8000-000000000001', 'Recovery fixture', 'recovery@workforce.test');
    INSERT INTO user_roles (user_id, role) VALUES ('10000000-0000-4000-8000-000000000001', 'employee');
    INSERT INTO employee_details (profile_id, work_categories, qualifications)
      VALUES ('10000000-0000-4000-8000-000000000001', ARRAY['traffic'], '{"verified":true}');
    INSERT INTO shifts (id, title, work_type, location, start_at, end_at, created_by, status)
      VALUES ('20000000-0000-4000-8000-000000000001', 'Recovery fixture', 'traffic', 'Amsterdam',
        '2099-01-01 09:00Z', '2099-01-01 17:00Z', '10000000-0000-4000-8000-000000000001', 'completed');
    INSERT INTO shift_applications (id, shift_id, employee_id, status)
      VALUES ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 'accepted');
    INSERT INTO shift_assignments (id, shift_id, employee_id, application_id, assigned_by, status)
      VALUES ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 'completed');
    INSERT INTO attendance_records (shift_assignment_id, check_in_at, check_out_at, attendance_status)
      VALUES ('40000000-0000-4000-8000-000000000001', '2099-01-01 09:00Z', '2099-01-01 17:00Z', 'checked_out');
    INSERT INTO notifications (recipient_id, type, title, related_shift_id, idempotency_key, idempotency_payload_hash)
      VALUES ('10000000-0000-4000-8000-000000000001', 'shift_created', 'Recovery fixture',
        '20000000-0000-4000-8000-000000000001', 'recovery-fixture', 'synthetic-hash');
    INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, new_values)
      VALUES ('system', 'RECOVERY_FIXTURE', 'shift', '20000000-0000-4000-8000-000000000001', '{"synthetic":true}');
    COMMIT;
  `);
  const before = await snapshot(source);
  for (const table of tables) assert.equal(before[table].length, 1);
  await exec(['pg_dump', '-U', 'workforce_test', '-d', source, '--format=custom', '--no-owner', '--no-acl', '--file', dump]);
  await exec(['createdb', '-U', 'workforce_test', '--template=template0', target]);
  assert.equal(await sql(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"), '0');
  await exec(['pg_restore', '-U', 'workforce_test', '-d', target, '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', dump]);
  assert.deepEqual(await snapshot(target), before, 'Restored schema, all fixture data and migration ledger must match');
  assert.deepEqual(await snapshot(source), before, 'Backup and restore must not alter the source database');
  await assert.rejects(sql(target, `INSERT INTO notifications (recipient_id, type, title, idempotency_key, idempotency_payload_hash)
    VALUES ('10000000-0000-4000-8000-000000000001', 'shift_created', 'Duplicate', 'recovery-fixture', 'synthetic-hash')`),
  /notifications_recipient_idempotency_key_uq/);
  await assert.rejects(sql(target, `INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('user', 'INVALID', 'test')`),
    /audit_logs_actor_type_ck/);
  console.log('Backup/restore rehearsal passed: pg_dump custom archive, separate empty database, all 9 tables, schema, enums, constraints, indexes, ledger and source preservation.');
  // Both databases and the archive disappear with the owned disposable container.
}
