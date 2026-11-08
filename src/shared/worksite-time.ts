export const DEFAULT_WORKSITE_TIME_ZONE = 'Europe/Amsterdam';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function dateKeyInTimeZone(instant: Date, timeZone: string): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError('Unable to determine the worksite date.');
  return `${year.padStart(4, '0')}-${month}-${day}`;
}
