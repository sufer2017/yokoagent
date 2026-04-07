import { cookies } from 'next/headers';
import { verifyToken } from './jwt';
import type { Session, UserRole } from '@/types/auth';

const COOKIE_NAME = 'yokoagent_token';

/**
 * Get the current session from the JWT cookie.
 * Returns null if not authenticated.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  return {
    role: payload.role,
    agentId: payload.agentId,
    agentName: payload.agentName,
  };
}

/**
 * Require authentication. Throws if not authenticated.
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  return session;
}

/**
 * Require a specific role. Throws if not authenticated or wrong role.
 */
export async function requireRole(role: UserRole): Promise<Session> {
  const session = await requireAuth();
  if (session.role !== role) {
    throw new Error('Forbidden');
  }
  return session;
}
