import { describe, expect, it } from 'vitest';
import { dutchLocalDateTimeToIso } from '@/frontend/features/admin-shifts/dutchDateTime';

describe('Dutch local shift date/time conversion', () => {
  it('uses the winter offset', () => {
    expect(dutchLocalDateTimeToIso('2027-01-15', '09:00')).toBe('2027-01-15T08:00:00.000Z');
  });

  it('uses the summer offset', () => {
    expect(dutchLocalDateTimeToIso('2027-07-15', '09:00')).toBe('2027-07-15T07:00:00.000Z');
  });

  it('rejects a local time skipped by the spring clock change', () => {
    expect(() => dutchLocalDateTimeToIso('2027-03-28', '02:30'))
      .toThrow(/does not exist/i);
  });

  it('chooses the earlier occurrence of an ambiguous fall-back time', () => {
    expect(dutchLocalDateTimeToIso('2027-10-31', '02:30')).toBe('2027-10-31T00:30:00.000Z');
  });

  it('rejects malformed or impossible local values', () => {
    expect(() => dutchLocalDateTimeToIso('2027-02-29', '09:00')).toThrow();
    expect(() => dutchLocalDateTimeToIso('2027-01-01', '24:00')).toThrow();
  });
});
