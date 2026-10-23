import 'server-only';
import { SignJWT, jwtVerify, importSPKI, importPKCS8, type JWTPayload, type KeyLike } from 'jose';
import { createHash, randomBytes } from 'crypto';
import { loadJwtKeyMaterial } from './jwtKeyMaterial.js';

// Types
export interface AccessTokenPayload extends JWTPayload {
  sub: string;        // user ID
  role: 'administrator' | 'supervisor' | 'employee';
  jti: string;        // JWT ID for session lookup
  ipHash: string;     // SHA-256 hash of client IP
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string; // opaque, never stored in plaintext
  accessTokenExpiresAt: number; // epoch ms
  refreshTokenExpiresAt: number; // epoch ms
}

let keysPromise: Promise<{ privateKey: KeyLike; publicKey: KeyLike }> | undefined;

async function loadAndValidateKeys(): Promise<{ privateKey: KeyLike; publicKey: KeyLike }> {
  const { privateKeyPem, publicKeyPem } = await loadJwtKeyMaterial();
  try {
    const [privateKey, publicKey] = await Promise.all([
      importPKCS8(privateKeyPem, 'RS256'),
      importSPKI(publicKeyPem, 'RS256'),
    ]);
    return { privateKey, publicKey };
  } catch {
    throw new Error('JWT keys must be valid RSA PKCS#8/SPKI keys with at least 2048-bit modulus.');
  }
}

function loadKeys(): Promise<{ privateKey: KeyLike; publicKey: KeyLike }> {
  keysPromise ??= loadAndValidateKeys();
  return keysPromise;
}

export async function assertJwtKeyConfiguration(): Promise<void> {
  await loadKeys();
}

/**
 * Generate a cryptographically random opaque token (32 bytes = 256 bits)
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hash of a token for storage
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash an IP address for token binding
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Create access JWT (RS256, 15 min) and opaque refresh token
 */
export async function createTokenPair(
  userId: string,
  role: 'administrator' | 'supervisor' | 'employee',
  ip: string
): Promise<TokenPair> {
  const { privateKey } = await loadKeys();
  const now = Math.floor(Date.now() / 1000);
  const accessTokenExpiresAt = now + 15 * 60; // 15 minutes
  const refreshTokenExpiresAt = now + 30 * 24 * 60 * 60; // 30 days

  const jti = randomBytes(16).toString('hex');
  const ipHash = hashIp(ip);

  const accessToken = await new SignJWT({
    sub: userId,
    role,
    jti,
    ipHash,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(accessTokenExpiresAt)
    .setJti(jti)
    .sign(privateKey);

  const refreshToken = generateOpaqueToken();

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt * 1000,
    refreshTokenExpiresAt: refreshTokenExpiresAt * 1000,
  };
}

/**
 * Verify access JWT and return payload
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  const { publicKey } = await loadKeys();
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });
    return payload as unknown as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Extract and verify token from cookie header
 */
export async function verifyTokenFromCookie(cookieHeader: string | null): Promise<AccessTokenPayload | null> {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/access_token=([^;]+)/);
  if (!match) return null;

  return verifyAccessToken(decodeURIComponent(match[1]));
}

/**
 * Decode JWT without verification (for extracting JTI from newly created token)
 * Only use this for tokens you just created and trust!
 */
export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return {};
    const decoded = Buffer.from(payloadPart, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}