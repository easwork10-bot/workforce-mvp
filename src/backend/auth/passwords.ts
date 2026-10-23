import 'server-only';
import argon2 from 'argon2';

// Argon2id parameters - memory cost 64MB, time cost 3, parallelism 2
const ARGON2_MEMORY_COST = parseInt(process.env.ARGON2_MEMORY_COST || '65536', 10);
const ARGON2_TIME_COST = parseInt(process.env.ARGON2_TIME_COST || '3', 10);
const ARGON2_PARALLELISM = parseInt(process.env.ARGON2_PARALLELISM || '2', 10);

/**
 * Hash a password using Argon2id
 * @param password - Plain text password
 * @returns Argon2id hash string (includes salt and parameters)
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    timeCost: ARGON2_TIME_COST,
    memoryCost: ARGON2_MEMORY_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: 32,
  });
}

/**
 * Verify a password against an Argon2id hash
 * @param password - Plain text password to verify
 * @param hash - Stored Argon2id hash
 * @returns True if password matches
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}