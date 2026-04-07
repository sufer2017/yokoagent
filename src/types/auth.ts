// ============================================================
// Auth Types
// ============================================================

export type UserRole = 'agent' | 'admin';

export interface JWTPayload {
  role: UserRole;
  agentId?: string;
  agentName?: string;
  exp?: number;
  iat?: number;
}

export interface Session {
  role: UserRole;
  agentId?: string;
  agentName?: string;
}

export interface LoginRequest {
  role: UserRole;
  name?: string;       // for agent login
  username?: string;    // for admin login
  password?: string;    // for admin login
}

export interface LoginResponse {
  success: boolean;
  message: string;
  session?: Session;
}
