// ============================================================
// API Request/Response Types
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface RecordFilters {
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  channelId?: string;
  projectId?: string;
}

export interface StatsFilters {
  dateFrom?: string;
  dateTo?: string;
  agentIds?: string[];
  productIds?: string[];
  channelIds?: string[];
  projectIds?: string[];
  groupBy?: 'agent' | 'channel' | 'project' | 'date';
}

export interface BatchRecordRequest {
  records: {
    id?: string;
    agent_id?: string;
    product_id?: string;
    channel_id?: string;
    record_date: string;
    creative_type: string;
    cost: number;
    activations: number;
    cpa?: number | null;
    ctr: number | null;
    cvr: number | null;
    cpm: number | null;
    retention_day1: number | null;
    retention_day7: number | null;
  }[];
}

export interface ConstraintViolation {
  record_id: string;
  record_date: string;
  agent_name: string;
  channel_name: string;
  project_name: string;
  constraint_name: string;
  constraint_metric: string;
  constraint_operator: string;
  constraint_value: number;
  actual_value: number;
}
