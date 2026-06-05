// ============================================================
// Auth Types
// ============================================================

export type UserRole = 'agent' | 'admin';

export interface JWTPayload {
  role: UserRole;
  agentId?: string;
  agentName?: string;
  productId?: string;
  productName?: string;
  channelId?: string;
  channelName?: string;
  exp?: number;
  iat?: number;
}

export interface Session {
  role: UserRole;
  agentId?: string;
  agentName?: string;
  productId?: string;
  productName?: string;
  channelId?: string;
  channelName?: string;
}

export interface LoginRequest {
  role: UserRole;
  username?: string;    // for agent/admin login
  password?: string;    // for agent/admin login
  name?: string;        // legacy agent login fallback
}

export interface LoginResponse {
  success: boolean;
  message: string;
  session?: Session;
}
