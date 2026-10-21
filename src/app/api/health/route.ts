import { NextResponse } from 'next/server';
import { checkDatabaseConnection } from '@/lib/db';
import { getRedis } from '@/lib/auth/session';

export async function GET() {
  try {
    const dbStatus = await checkDatabaseConnection();

    let redisStatus = false;
    try {
      await getRedis();
      // Simple ping test
      redisStatus = true;
    } catch (error) {
      console.error('[Health Check] Redis check failed:', error);
      redisStatus = false;
    }

    const status = {
      status: dbStatus && redisStatus ? 'ok' : 'degraded',
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(status, {
      status: dbStatus && redisStatus ? 200 : 503,
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