import 'server-only';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

// The only supported proxy topology overwrites these headers with one socket IP.
export function getClientIp(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  if (ip === null) return '127.0.0.1';
  const value = ip.trim();
  if (isIP(value)) return value;
  console.warn('[Proxy] Invalid client IP header; using a shared rate-limit bucket.');
  return 'unknown';
}
