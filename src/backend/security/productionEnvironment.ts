export function assertProductionEnvironment(): void {
  if (process.env.NODE_ENV !== 'production') return;
  for (const [name, protocols] of [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['REDIS_URL', ['redis:', 'rediss:']],
  ] as const) {
    let url: URL;
    try {
      url = new URL(process.env[name] || '');
    } catch {
      throw new Error(`${name} must be explicitly configured with a valid production URL.`);
    }
    if (!(protocols as readonly string[]).includes(url.protocol) || !url.hostname) {
      throw new Error(`${name} has an unsupported production URL protocol or host.`);
    }
  }
}
