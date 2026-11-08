import { createHash, randomUUID } from 'node:crypto';
import { test as base, type Page } from '@playwright/test';
import { importPKCS8, SignJWT } from 'jose';
import { createClient } from 'redis';
import { Client } from 'pg';
import { verifyTestDatabaseTarget } from '../support/database/testDatabaseSafety';

type Role = 'administrator' | 'employee';

function authenticatedTest(role: Role) {
  return base.extend<{ authenticatedPage: void }>({
    authenticatedPage: [async ({ page }: { page: Page }, use) => {
      if (!process.env.WORKFORCE_SAFE_BROWSER_APP || !process.env.REDIS_URL || !process.env.JWT_PRIVATE_KEY_B64) {
        throw new Error('Authenticated browser fixtures require the guarded integration runner.');
      }
      await verifyTestDatabaseTarget(process.env.DATABASE_URL, process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,
        undefined, process.env.WORKFORCE_TEST_DB_SERVER_PORT);
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      const redis = createClient({ url: process.env.REDIS_URL });
      let dbConnected = false;
      let redisConnected = false;
      const id = randomUUID();
      const jti = randomUUID();
      const email = `page-auth-${id}@workforce.test`;
      const refreshHash = createHash('sha256').update(randomUUID()).digest('hex');
      try {
        await db.connect();
        dbConnected = true;
        await redis.connect();
        redisConnected = true;
        const key = await importPKCS8(Buffer.from(process.env.JWT_PRIVATE_KEY_B64, 'base64').toString('utf8'), 'RS256');
        const token = await new SignJWT({ role, ipHash: 'test' })
          .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
          .setSubject(id).setJti(jti).setIssuedAt().setExpirationTime('15m').sign(key);
        await db.query(
          'INSERT INTO profiles (id, full_name, email) VALUES ($1, $2, $3)',
          [id, `Browser ${role}`, email]
        );
        await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
        await redis.hSet(`session:${jti}`, { userId: id, role, refreshHash });
        await redis.expire(`session:${jti}`, 900);
        await redis.hSet(`refresh:${id}:${refreshHash}`, { sessionId: jti, used: 'false' });
        await redis.expire(`refresh:${id}:${refreshHash}`, 900);
        await page.context().addCookies([{
          name: 'access_token', value: token, url: 'https://localhost:3197', httpOnly: true, secure: true,
        }]);
        await use();
      } finally {
        try {
          if (redisConnected) {
            try {
              await redis.del(`session:${jti}`, `refresh:${id}:${refreshHash}`);
            } finally {
              await redis.quit();
            }
          }
        } finally {
          if (dbConnected) {
            try {
              await db.query('DELETE FROM profiles WHERE id = $1', [id]);
            } finally {
              await db.end();
            }
          }
        }
      }
    }, { auto: true }],
  });
}

export const adminTest = authenticatedTest('administrator');
export const employeeTest = authenticatedTest('employee');
