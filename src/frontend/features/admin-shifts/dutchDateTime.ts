import { DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DEFAULT_WORKSITE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function wallClockParts(timestamp: number): number[] {
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return [
    Number(values.year),
    Number(values.month),
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ];
}

function sameWallClock(left: number[], right: number[]): boolean {
  return left.every((value, index) => value === right[index]);
}

export function dutchLocalDateTimeToIso(date: string, time: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new RangeError('Enter a valid Dutch date and time.');

  const target = [
    Number(dateMatch[1]),
    Number(dateMatch[2]),
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
  ];
  const wallClockAsUtc = Date.UTC(
    target[0],
    target[1] - 1,
    target[2],
    target[3],
    target[4],
  );
  const validationDate = new Date(wallClockAsUtc);
  if (
    target[1] < 1
    || target[1] > 12
    || target[2] < 1
    || target[2] > 31
    || target[3] < 0
    || target[3] > 23
    || target[4] < 0
    || target[4] > 59
    || validationDate.getUTCFullYear() !== target[0]
    || validationDate.getUTCMonth() + 1 !== target[1]
    || validationDate.getUTCDate() !== target[2]
  ) {
    throw new RangeError('Enter a valid Dutch date and time.');
  }

  const candidates = new Set<number>();
  for (let offset = -36; offset <= 36; offset += 6) {
    const sample = wallClockAsUtc + offset * 60 * 60 * 1000;
    const sampleParts = wallClockParts(sample);
    const [year, month, day, hour, minute, second] = sampleParts;
    const zoneOffset = Date.UTC(year, month - 1, day, hour, minute, second) - sample;
    const candidate = wallClockAsUtc - zoneOffset;
    if (sameWallClock(wallClockParts(candidate), target)) candidates.add(candidate);
  }

  if (candidates.size === 0) {
    throw new RangeError('This local time does not exist in the Netherlands because of the daylight-saving change.');
  }

  return new Date(Math.min(...candidates)).toISOString();
}
