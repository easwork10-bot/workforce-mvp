import { z } from 'zod';

const utcDateTimeSchema = z.string().datetime();

export function uuidLikeString(message = 'Invalid uuid') {
  return z.guid(message);
}

export function isoDateTimeString({ offset = false }: { offset?: boolean } = {}) {
  return z.string().refine(value => {
    // Preserve the previously accepted minute-only and non-colon offset formats.
    const utc = offset ? value.replace(/[+-]\d{2}:?\d{2}$/, 'Z') : value;
    const withSeconds = utc.replace(/T(\d{2}:\d{2})Z$/, 'T$1:00Z');
    return utcDateTimeSchema.safeParse(withSeconds).success;
  }, 'Invalid datetime');
}
