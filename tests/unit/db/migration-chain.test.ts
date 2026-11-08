import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { shiftApplications, shiftAssignments } from '@/backend/db/schema';
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
});
