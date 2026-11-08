import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { auditLogs, notifications, shiftApplications, shiftAssignments } from '@/backend/db/schema';
import { describe, expect, it } from 'vitest';

describe('journaled migration history', () => {
  const folder = path.join(process.cwd(), 'drizzle');

  it.each([
    ['0003', '0004', 'public.shift_applications', 'unique_shift_employee', 'unique_pending_shift_employee',
      '"shift_applications"."status" = \'pending\'', shiftApplications],
    ['0004', '0005', 'public.shift_assignments', 'unique_shift_assignment_employee', 'unique_active_shift_assignment_employee',
      '"shift_assignments"."status" IN (\'assigned\', \'confirmed\')', shiftAssignments],
  ] as const)('aligns snapshot %s -> %s with the schema', async (previousId, currentId, table, oldIndex, newIndex, predicate, schema) => {
    type Snapshot = { id: string; prevId: string; tables: Record<string, { indexes: Record<string, unknown> }>; enums: Record<string, unknown> };
    const previous: Snapshot = JSON.parse(await readFile(path.join(folder, 'meta', `${previousId}_snapshot.json`), 'utf8'));
    const current: Snapshot = JSON.parse(await readFile(path.join(folder, 'meta', `${currentId}_snapshot.json`), 'utf8'));
    expect(current.prevId).toBe(previous.id);
    expect(current.enums).toEqual(previous.enums);
    const expected = structuredClone(previous.tables);
    delete expected[table].indexes[oldIndex];
    expected[table].indexes[newIndex] = current.tables[table].indexes[newIndex];
    expect(current.tables).toEqual(expected);
    expect(current.tables[table].indexes[newIndex]).toMatchObject({ isUnique: true, where: predicate });
    const indexes = getTableConfig(schema).indexes;
    expect(indexes.some(index => index.config.name === oldIndex)).toBe(false);
    const index = indexes.find(item => item.config.name === newIndex);
    expect(index?.config.unique).toBe(true);
    if (!index?.config.where) throw new Error(`Missing predicate for ${newIndex}`);
    expect(new PgDialect().sqlToQuery(index.config.where).sql).toBe(predicate);
  });

  it('reads the six journaled migrations in order and creates replacement indexes first', async () => {
    const journal = JSON.parse(await readFile(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    expect(journal.entries.map(entry => entry.tag)).toEqual([
      '0000_wild_agent_zero', '0001_notification_idempotency_expand',
      '0002_retire_notification_legacy_indexes', '0003_damp_unus',
      '0004_application_history', '0005_assignment_history',
    ]);
    expect(journal.entries.map(entry => entry.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    expect(migrations.map(migration => migration.folderMillis)).toEqual(journal.entries.map(entry => entry.when));
    expect(migrations).toHaveLength(6);
    for (const [index, added, removed] of [
      [4, 'unique_pending_shift_employee', 'unique_shift_employee'],
      [5, 'unique_active_shift_assignment_employee', 'unique_shift_assignment_employee'],
    ] as const) {
      const sql = migrations[index].sql.join('\n');
      const create = sql.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS "${added}"`);
      const drop = sql.indexOf(`DROP INDEX IF EXISTS "${removed}"`);
      expect(create).toBeGreaterThanOrEqual(0);
      expect(drop).toBeGreaterThan(create);
    }
  });

  it('records existing check constraints in the snapshots where their migrations introduced them', async () => {
    const checks = [
      { table: 'public.notifications', name: 'notifications_idempotency_fields_ck', introduced: 1, schema: notifications },
      { table: 'public.audit_logs', name: 'audit_logs_actor_type_ck', introduced: 3, schema: auditLogs },
    ] as const;
    const dialect = new PgDialect();

    for (const { table, name, introduced, schema } of checks) {
      const check = getTableConfig(schema).checks.find(item => item.name === name);
      if (!check) throw new Error(`Missing schema check ${name}`);
      const expected = { name, value: dialect.sqlToQuery(check.value).sql };

      for (let index = 0; index <= 5; index++) {
        const id = String(index).padStart(4, '0');
        const snapshot: {
          tables: Record<string, { checkConstraints?: Record<string, { name: string; value: string }> }>;
        } = JSON.parse(await readFile(path.join(folder, 'meta', `${id}_snapshot.json`), 'utf8'));
        const recorded = snapshot.tables[table].checkConstraints?.[name];
        if (index < introduced) expect(recorded).toBeUndefined();
        else expect(recorded).toEqual(expected);
      }
    }

    expect(await readFile(path.join(folder, '0001_notification_idempotency_expand.sql'), 'utf8'))
      .toContain('ADD CONSTRAINT "notifications_idempotency_fields_ck"');
    expect(await readFile(path.join(folder, '0003_damp_unus.sql'), 'utf8'))
      .toContain('ADD CONSTRAINT "audit_logs_actor_type_ck"');
  });
});
