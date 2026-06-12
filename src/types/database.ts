// ============================================================
// YokoAgent Database Types
// ============================================================

export interface Agent {
  id: string;
  product_id: string;
  channel_id: string;
  name: string;
  username: string;
  creative_types: string[];
  authorized_scopes?: AgentAuthorizedScope[];
  feishu_webhook?: string | null;
  password_hash?: string;
  password_plaintext?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  product_name?: string;
  channel_name?: string;
}

export interface DictionaryItem {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CreativeTypeItem = DictionaryItem;
export type PromotionGoalItem = DictionaryItem;

export interface AgentAuthorizedScope {
  id: string;
  agent_id: string;
  creative_type: string;
  promotion_goal: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
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
  product_id: string;
  record_date: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  cost: number;
  activations: number;
  cpa: number | null;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
}

/** DailyRecord with computed checks and joined names */
export interface DailyRecordView extends DailyRecord {
  activation_cost: number | null;
  cpa_check_delta: number | null;
  target_cpa?: number | null;
  target_retention_day1?: number | null;
  target_retention_day7?: number | null;
  activation_cap?: number | null;
  agent_name?: string;
  product_name?: string;
  channel_name?: string;
  project_name?: string;
}

export interface TargetChange {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  is_running: boolean;
  effective_date: string;
  target_cpa: number | null;
  target_retention_day1: number | null;
  target_retention_day7: number | null;
  activation_cap: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  product_name?: string;
  channel_name?: string;
}

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface AlertIssueStatus {
  id: string;
  alert_result_id: string;
  issue_key: string;
  status: AlertStatus;
  created_at: string;
  updated_at: string;
}

export type AlertThresholdMetricKey =
  | 'cost_dod'
  | 'cost_wow'
  | 'activations_dod'
  | 'activations_wow'
  | 'cpa_target_deviation'
  | 'cpa_dod'
  | 'cpa_wow'
  | 'retention_day1_dod'
  | 'retention_day1_wow'
  | 'retention_day1_target_deviation'
  | 'retention_day7_dod'
  | 'retention_day7_wow'
  | 'retention_day7_target_deviation';

export interface AlertThresholdSetting {
  id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  metric_key: AlertThresholdMetricKey;
  upper_threshold: number | null;
  lower_threshold: number | null;
  created_at: string;
  updated_at: string;
}

export interface AlertResult {
  id: string;
  daily_record_id: string;
  record_date: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  cost_dod: number | null;
  activations_dod: number | null;
  cpa_dod: number | null;
  ctr_dod: number | null;
  cvr_dod: number | null;
  cpm_dod: number | null;
  retention_day1_dod: number | null;
  retention_day7_dod: number | null;
  cost_wow: number | null;
  activations_wow: number | null;
  cpa_wow: number | null;
  ctr_wow: number | null;
  cvr_wow: number | null;
  cpm_wow: number | null;
  retention_day1_wow: number | null;
  retention_day7_wow: number | null;
  cpa_target_deviation: number | null;
  retention_day1_target_deviation: number | null;
  retention_day7_target_deviation: number | null;
  is_cost_alert: boolean;
  is_activations_alert: boolean;
  is_cpa_alert: boolean;
  is_retention_day1_alert: boolean;
  is_retention_day7_alert: boolean;
  has_alert: boolean;
  alert_summary: string;
  status: AlertStatus;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  product_name?: string;
  channel_name?: string;
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
