import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  getRedis: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
}));

vi.mock('@/backend/db', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@/backend/auth/session', () => ({ getRedis: mocks.getRedis }));

import { applyForShiftWithLock } from '@/backend/db/queries/applications';

function uniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key'), { code: '23505', constraint });
}

describe('Drizzle security and error compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockResolvedValue('OK');
    mocks.eval.mockResolvedValue(1);
    mocks.getRedis.mockResolvedValue({ set: mocks.set, eval: mocks.eval });
  });

  afterEach(() => vi.restoreAllMocks());

  it('escapes embedded PostgreSQL identifier delimiters', () => {
    const identifier = 'sort"; SELECT 1;--';
    const query = new PgDialect().sqlToQuery(sql`select ${sql.identifier(identifier)}`);
    expect(query.sql).toBe('select "sort""; SELECT 1;--"');
    expect(query.params).toEqual([]);
  });

  it.each([
    ['driver error', () => uniqueViolation('unique_pending_shift_employee')],
    ['wrapped driver error', () => new DrizzleQueryError(
      'insert', [], uniqueViolation('unique_pending_shift_employee'),
    )],
  ])('returns the existing duplicate result for a %s', async (_label, makeError) => {
    mocks.transaction.mockRejectedValue(makeError());

    await expect(applyForShiftWithLock('shift', 'employee')).resolves.toMatchObject({
      success: false, code: 'DUPLICATE_APPLICATION',
    });
    expect(mocks.eval).toHaveBeenCalledOnce();
  });

  it('does not misclassify another unique constraint as a duplicate application', async () => {
    const error = new DrizzleQueryError('insert', [], uniqueViolation('another_constraint'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.transaction.mockRejectedValue(error);

    await expect(applyForShiftWithLock('shift', 'employee')).resolves.toMatchObject({
      success: false, code: 'INTERNAL_ERROR',
    });
    expect(log).toHaveBeenCalledWith('[applyForShiftWithLock] Application transaction failed:', error);
    expect(mocks.eval).toHaveBeenCalledOnce();
  });
});
