import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '@/backend/db';
import { getRedis } from '@/backend/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dbStatus = await checkDatabaseConnection();

    let redisStatus = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        getRedis().then(async redis => {
          if (await redis.ping() !== 'PONG') throw new Error('Unexpected Redis probe response');
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis probe timed out')), 3000);
        }),
      ]);
      redisStatus = true;
    } catch (error) {
      console.error('[Health Check] Redis probe failed.');
      redisStatus = false;
    } finally {
      clearTimeout(timeout);
    }

    const status = {
      status: dbStatus && redisStatus ? 'ok' : 'degraded',
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(status, {
      status: dbStatus && redisStatus ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[Health Check] Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        db: false,
        redis: false,
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      },
      { status: 503 }
    );
  }
}
