import { describe, expect, it } from 'vitest';
import { employeeQuerySchema, updateEmployeeSchema } from '@/backend/validation/employees';
import { createShiftSchema, shiftIdParamSchema, shiftQuerySchema, updateShiftSchema } from '@/backend/validation/shifts';
import { adminApplicationPageSchema } from '@/shared/admin-applications';
import { adminAssignmentPageSchema } from '@/shared/admin-assignments';
import { isoDateTimeString, uuidLikeString } from '@/shared/validation';

const legacyId = '00000000-0000-0000-0000-000000000001';
const pagination = { page: 1, limit: 100, total: 100, totalPages: 1 };
const assignment = {
  id: legacyId,
  shiftId: legacyId,
  employeeId: legacyId,
  applicationId: null,
  status: 'assigned',
  assignedBy: legacyId,
  assignedAt: '2099-01-15T08:00Z',
  confirmedAt: null,
  employee: { id: legacyId, fullName: 'Employee' },
  shift: {
    id: legacyId, title: 'Shift', location: 'Amsterdam',
    startAt: '2099-01-15T08:00Z', endAt: '2099-01-15T10:00Z',
  },
};
const application = {
  id: legacyId,
  shiftId: legacyId,
  employeeId: legacyId,
  status: 'pending',
  appliedAt: '2099-01-15T08:00Z',
  rejectionReason: null,
  employee: { fullName: 'Employee', email: 'employee@example.test', phone: null },
  shift: {
    title: 'Shift', startAt: '2099-01-15T08:00Z', endAt: '2099-01-15T10:00Z',
    location: 'Amsterdam', status: 'open', requiredWorkers: 1, assignedCount: 0,
  },
};

describe('dependency validation compatibility', () => {
  it('retains UUID-shaped identifiers and their existing error messages', () => {
    expect(shiftIdParamSchema.parse({ id: legacyId })).toEqual({ id: legacyId });
    expect(uuidLikeString().parse('12345678-1234-1234-1234-123456789abc'))
      .toBe('12345678-1234-1234-1234-123456789abc');
    const invalid = uuidLikeString().safeParse('not-a-uuid');
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('Expected an invalid identifier');
    expect(invalid.error.issues[0].message).toBe('Invalid uuid');
    expect(shiftIdParamSchema.safeParse({ id: 'not-a-uuid' }).error?.flatten().fieldErrors.id)
      .toEqual(['Invalid shift ID']);
  });

  it.each([
    '2099-01-15T08:00Z',
    '2099-01-15T08:00:00.123Z',
    '2099-01-15T08:00+0100',
    '2099-01-15T08:00:00+01:00',
    '2099-01-15T08:00:00-1200',
    '2099-01-15T08:00:00+99:99',
  ])('preserves accepted offset datetime %s without rewriting it', value => {
    expect(isoDateTimeString({ offset: true }).parse(value)).toBe(value);
  });

  it.each([
    '2099-02-29T08:00Z',
    '2099-01-15T24:00Z',
    '2099-01-15T08:00',
    '2099-01-15T08:00+01',
    'not-a-date',
  ])('rejects invalid datetime %s', value => {
    const result = isoDateTimeString({ offset: true }).safeParse(value);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected an invalid datetime');
    expect(result.error.issues[0].message).toBe('Invalid datetime');
  });

  it('keeps UTC response timestamps separate from offset-enabled request timestamps', () => {
    expect(isoDateTimeString().parse('2099-01-15T08:00Z')).toBe('2099-01-15T08:00Z');
    expect(isoDateTimeString().safeParse('2099-01-15T08:00+0100').success).toBe(false);

    const startAt = '2099-01-15T08:00+0100';
    const endAt = '2099-01-15T10:00+0100';
    expect(createShiftSchema.parse({
      title: 'Morning shift', workType: 'Cleaning', location: 'Amsterdam',
      startAt, endAt, requiredWorkers: 1,
    })).toMatchObject({ startAt, endAt });
    expect(updateShiftSchema.parse({ startAt, endAt })).toEqual({ startAt, endAt });
    expect(shiftQuerySchema.parse({ startFrom: startAt, startTo: endAt }))
      .toMatchObject({ startFrom: startAt, startTo: endAt });
  });

  it('retains calendar date validation for leap days', () => {
    expect(updateEmployeeSchema.parse({ dateOfBirth: '2000-02-29' }).dateOfBirth).toBe('2000-02-29');
    expect(updateEmployeeSchema.safeParse({ dateOfBirth: '1900-02-29' }).success).toBe(false);
  });

  it('rejects unsafe integer page numbers with the existing field-error shape', () => {
    expect(employeeQuerySchema.parse({ page: String(Number.MAX_SAFE_INTEGER) }).page)
      .toBe(Number.MAX_SAFE_INTEGER);
    const unsafe = employeeQuerySchema.safeParse({ page: '9007199254740992' });
    expect(unsafe.success).toBe(false);
    if (unsafe.success) throw new Error('Expected an unsafe page number to fail');
    expect(unsafe.error.flatten().fieldErrors.page).toHaveLength(1);
  });

  it.each([
    { schema: adminAssignmentPageSchema, key: 'assignments', record: assignment },
    { schema: adminApplicationPageSchema, key: 'applications', record: application },
  ] as const)('accepts 100 $key and rejects oversized arrays before parsing entries', ({ schema, key, record }) => {
    const valid = schema.safeParse({ [key]: Array.from({ length: 100 }, () => record), pagination });
    expect(valid.success).toBe(true);

    const justOverLimit = schema.safeParse({ [key]: Array.from({ length: 101 }, () => record), pagination });
    expect(justOverLimit.success).toBe(false);

    const oversized = schema.safeParse({ [key]: Array.from({ length: 10000 }, () => ({})), pagination });
    expect(oversized.success).toBe(false);
    if (oversized.success) throw new Error('Expected an oversized response to fail');
    expect(oversized.error.issues).toHaveLength(1);
    expect(oversized.error.issues[0]).toMatchObject({ code: 'too_big', maximum: 100, path: [key] });
  });

  it('stops at the first invalid work category without limiting valid arrays', () => {
    const categories = Array.from({ length: 250 }, (_, index) => `category-${index}`);
    expect(updateEmployeeSchema.parse({ workCategories: categories }).workCategories).toEqual(categories);
    expect(updateEmployeeSchema.parse({})).toEqual({});

    const invalid = updateEmployeeSchema.safeParse({
      workCategories: ['valid', ...Array.from({ length: 10000 }, () => false)],
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('Expected invalid work categories');
    expect(invalid.error.issues).toHaveLength(1);
    expect(invalid.error.issues[0]).toMatchObject({
      code: 'invalid_type', expected: 'string', path: ['workCategories', 1],
    });
    expect(invalid.error.flatten().fieldErrors.workCategories).toHaveLength(1);
  });
});
