import { verifyTestDatabaseTarget } from './testDatabaseSafety';

export async function setup(): Promise<void> {
  await verifyTestDatabaseTarget(
    process.env.DATABASE_URL,
    process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,
    undefined,
    process.env.WORKFORCE_TEST_DB_SERVER_PORT
  );
}
