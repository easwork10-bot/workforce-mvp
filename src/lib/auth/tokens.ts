import { SignJWT, jwtVerify, importSPKI, importPKCS8, type JWTPayload, type KeyLike } from 'jose';
import { createHash, randomBytes } from 'crypto';

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

// Key loading - cached after first load
let privateKey: KeyLike | null = null;
let publicKey: KeyLike | null = null;

async function loadKeys(): Promise<{ privateKey: KeyLike; publicKey: KeyLike }> {
  if (privateKey && publicKey) return { privateKey, publicKey };

  // Load keys from environment variables (base64 encoded) or file system
  let privateKeyPem: string;
  let publicKeyPem: string;

  const privateKeyB64 = process.env.JWT_PRIVATE_KEY_B64;
  const publicKeyB64 = process.env.JWT_PUBLIC_KEY_B64;

  if (privateKeyB64 && publicKeyB64) {
    privateKeyPem = Buffer.from(privateKeyB64, 'base64').toString('utf-8');
    publicKeyPem = Buffer.from(publicKeyB64, 'base64').toString('utf-8');
  } else {
    // Fallback to reading from file system (for standalone builds)
    const fs = await import('fs/promises');
    const path = await import('path');

    // Try multiple locations for the secrets directory
    const possiblePaths = [
      path.join(process.cwd(), 'secrets'),
      path.join(__dirname, '../../secrets'),
      path.join(__dirname, '../../../secrets'),
    ];

    let privateKeyPath: string | null = null;
    let publicKeyPath: string | null = null;

    for (const secretsDir of possiblePaths) {
      try {
        const privatePath = path.join(secretsDir, 'jwt_private_key.pem');
        const publicPath = path.join(secretsDir, 'jwt_public_key.pem');
        await fs.access(privatePath);
        await fs.access(publicPath);
        privateKeyPath = privatePath;
        publicKeyPath = publicPath;
        break;
      } catch {
        // Continue to next path
      }
    }

    if (!privateKeyPath || !publicKeyPath) {
      throw new Error('JWT keys not found. Set JWT_PRIVATE_KEY_B64/JWT_PUBLIC_KEY_B64 or place keys in secrets/ directory');
    }

    privateKeyPem = await fs.readFile(privateKeyPath, 'utf-8');
    publicKeyPem = await fs.readFile(publicKeyPath, 'utf-8');
  }

  privateKey = await importPKCS8(privateKeyPem, 'RS256');
  publicKey = await importSPKI(publicKeyPem, 'RS256');

  return { privateKey, publicKey };
}

async function getPrivateKey(): Promise<KeyLike> {
  const { privateKey: key } = await loadKeys();
  return key;
}

async function getPublicKey(): Promise<KeyLike> {
  const { publicKey: key } = await loadKeys();
  return key;
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
  const privateKey = await getPrivateKey();
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
  try {
    console.log('[verifyAccessToken] Verifying token, length:', token.length);
    const publicKey = await getPublicKey();
    console.log('[verifyAccessToken] Got public key');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });
    console.log('[verifyAccessToken] Token verified successfully');
    return payload as unknown as AccessTokenPayload;
  } catch (error) {
    console.error('[verifyAccessToken] Error:', error);
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