// ============================================================
// YokoAgent Database Types
// ============================================================

export interface Agent {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailyRecord {
  id: string;
  agent_id: string;
  record_date: string;
  channel_id: string;
  project_id: string;
  cost: number;
  activations: number;
  retention_day1: number | null;
  retention_day7: number | null;
  created_at: string;
  updated_at: string;
}

/** DailyRecord with computed activation_cost and joined names */
export interface DailyRecordView extends DailyRecord {
  activation_cost: number | null;
  agent_name?: string;
  channel_name?: string;
  project_name?: string;
}

export interface ChannelBudget {
  id: string;
  channel_id: string;
  budget_amount: number;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
  channel_name?: string;
}

export interface AgentChannelAllocation {
  id: string;
  channel_budget_id: string;
  agent_id: string;
  spending_cap: number;
  activation_floor: number;
  created_at: string;
  updated_at: string;
  agent_name?: string;
}

export type ConstraintType = 'hard' | 'custom';
export type ConstraintOperator = '<=' | '>=' | '=' | '<' | '>';

export interface Constraint {
  id: string;
  name: string;
  type: ConstraintType;
  metric: string;
  operator: ConstraintOperator;
  value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}
