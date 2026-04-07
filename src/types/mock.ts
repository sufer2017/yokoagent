import type { Agent, Channel, Project } from './database';

export interface PerformanceRecord {
  id: string;
  date: string;
  channelId: string;
  channelName: string;
  agentId: string;
  agentName: string;
  projectId: string;
  projectName: string;
  cost: number;
  activations: number;
  activationCost: number;
  retentionDay1: number;
  retentionDay7: number;
}

export interface ChannelShareConstraint {
  channelId: string;
  minShare: number;
  maxShare: number;
}

export interface WeeklyConstraintSet {
  id: string;
  weekStart: string;
  weekEnd: string;
  budgetUpperBound: number;
  minActivations: number;
  minRetentionDay1: number;
  minRetentionDay7: number;
  channelShareConstraints: ChannelShareConstraint[];
  createdAt: string;
  updatedAt: string;
}

export interface ConstraintForecastStatus {
  key: 'budget' | 'activations' | 'retention_day1' | 'retention_day7';
  label: string;
  target: number;
  actual: number;
  met: boolean;
  delta: number;
}

export interface ChannelAllocationResult {
  channelId: string;
  channelName: string;
  score: number;
  budgetAmount: number;
  budgetShare: number;
  predictedActivations: number;
  predictedActivationCost: number;
  predictedRetentionDay1: number;
  predictedRetentionDay7: number;
  vsHistoryActivationCost: number;
  vsPeersActivationCost: number;
  rationale: string;
  constraintNotes: string[];
}

export interface AgentAllocationResult {
  channelId: string;
  channelName: string;
  agentId: string;
  agentName: string;
  score: number;
  rank: number;
  budgetAmount: number;
  budgetShareWithinChannel: number;
  predictedActivations: number;
  predictedActivationCost: number;
  predictedRetentionDay1: number;
  predictedRetentionDay7: number;
  vsChannelAverageActivationCost: number;
  vsChannelAverageRetentionDay1: number;
  rationale: string;
}

export interface AllocationPlanVersion {
  id: string;
  strategyId: string;
  versionNumber: number;
  createdAt: string;
  reason: string;
  channelAllocations: ChannelAllocationResult[];
  agentAllocations: AgentAllocationResult[];
  forecastSummary: {
    totalBudget: number;
    predictedActivations: number;
    predictedActivationCost: number;
    predictedRetentionDay1: number;
    predictedRetentionDay7: number;
    statuses: ConstraintForecastStatus[];
    summary: string;
    warnings: string[];
    requiresReallocation: boolean;
  };
}

export interface ScopeMetricSnapshot {
  cost: number;
  activations: number;
  activationCost: number;
  retentionDay1: number;
  retentionDay7: number;
}

export interface PerformanceInsight {
  id: string;
  scope: 'channel' | 'agent';
  scopeId: string;
  scopeLabel: string;
  parentLabel?: string;
  rank: number;
  summary: string;
  warningCount: number;
  metrics: ScopeMetricSnapshot;
  vsPreviousWeekActivationCost: number;
  vsTrailing7dActivationCost: number;
  vsPeersActivationCost: number;
  vsPeersRetentionDay1: number;
  paceGap: number;
}

export interface DailyReportSnapshot {
  date: string;
  headline: string;
  totals: ScopeMetricSnapshot;
  channelHighlights: string[];
  channelRisks: string[];
  agentHighlights: string[];
  agentRisks: string[];
  warnings: string[];
  shouldReallocate: boolean;
  evidence: string[];
  markdown: string;
}

export interface StrategyDraftInput {
  weekStart: string;
  weekEnd: string;
  budgetUpperBound: number;
  minActivations: number;
  minRetentionDay1: number;
  minRetentionDay7: number;
  channelShareConstraints: ChannelShareConstraint[];
  reason: string;
}

export interface MockAppState {
  agents: Agent[];
  channels: Channel[];
  projects: Project[];
  records: PerformanceRecord[];
  strategies: WeeklyConstraintSet[];
  plans: AllocationPlanVersion[];
}
