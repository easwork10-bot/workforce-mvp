import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

const TRUSTED_PROXY_HEADERS = new Set(['x-forwarded-for', 'x-real-ip']);

export function assertTrustedClientIpConfiguration(): void {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (header && !TRUSTED_PROXY_HEADERS.has(header)) {
    throw new Error('TRUSTED_CLIENT_IP_HEADER must be x-forwarded-for or x-real-ip.');
  }
}

export function getTrustedClientIp(request: Pick<NextRequest, 'ip' | 'headers'>): string | null {
  const address = request.ip;
  if (address && isIP(address)) return address;

  if (process.env.NODE_ENV !== 'production') return '127.0.0.1';

  const header = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!header || !TRUSTED_PROXY_HEADERS.has(header)) return null;

  const forwardedAddress = request.headers.get(header);
  if (!forwardedAddress) return null;
  const candidate = header === 'x-forwarded-for'
    ? forwardedAddress.split(',')[0].trim()
    : forwardedAddress.trim();
  return isIP(candidate) ? candidate : null;
}
