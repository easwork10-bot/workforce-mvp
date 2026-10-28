export function requireRedisUrl(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('REDIS_URL must be explicitly configured before connecting to Redis.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a valid Redis connection URL.');
  }

  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('REDIS_URL must identify a Redis host.');
  }

  return value;
}
