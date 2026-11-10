import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Database connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Drizzle instance with schema
export const db = drizzle(pool, { schema });

// Helper to run migrations programmatically (for development)
export async function runMigrations(): Promise<void> {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db, { migrationsFolder: './drizzle' });
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  await pool.end();
}

// Health check
export async function checkDatabaseConnection(): Promise<boolean> {
  let client;
  try {
    client = await pool.connect();
    const probe = { text: 'SELECT 1', query_timeout: 3000 };
    await client.query(probe);
    return true;
  } catch {
    console.error('[Health Check] PostgreSQL probe failed.');
    return false;
  } finally {
    client?.release();
  }
}
