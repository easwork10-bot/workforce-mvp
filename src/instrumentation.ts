export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    try {
      const instrumentation = await import('./instrumentation-node');
      await instrumentation.register();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown startup configuration error.';
      console.error(`[Startup] ${message}`);
      process.exit(1);
    }
  }
}
