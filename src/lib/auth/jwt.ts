import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from '@/types/auth';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'yokoagent-dev-secret-change-me'
);

const TOKEN_EXPIRY = '24h';

/**
 * Sign a JWT token with the given payload.
 */
export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT token.
 * Returns null if verification fails.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
