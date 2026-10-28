export function requireDatabaseUrl(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('DATABASE_URL must be explicitly configured before connecting to PostgreSQL.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || !url.pathname
    || url.pathname === '/'
    || url.hash
  ) {
    throw new Error('DATABASE_URL must identify a PostgreSQL host and database.');
  }

  if (
    url.port
    && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535)
  ) {
    throw new Error('DATABASE_URL must specify a valid PostgreSQL port.');
  }

  const endpointOverrides = new Set([
    'host',
    'hostaddr',
    'port',
    'database',
    'dbname',
    'service',
    'servicefile',
  ]);
  if ([...url.searchParams.keys()].some((key) => endpointOverrides.has(key.toLowerCase()))) {
    throw new Error('DATABASE_URL must not override its PostgreSQL endpoint in query parameters.');
  }

  return value;
}
