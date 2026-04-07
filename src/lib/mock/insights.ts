import dayjs from 'dayjs';
import type { AllocationPlanVersion, PerformanceInsight, PerformanceRecord, WeeklyConstraintSet } from '@/types/mock';

interface ScopeRecord {
  scopeId: string;
  scopeLabel: string;
  parentLabel?: string;
  records: PerformanceRecord[];
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(records: PerformanceRecord[]) {
  const cost = records.reduce((sum, record) => sum + record.cost, 0);
  const activations = records.reduce((sum, record) => sum + record.activations, 0);
  const activationCost = activations > 0 ? cost / activations : 0;

  return {
    cost,
    activations,
    activationCost,
    retentionDay1: average(records.map((record) => record.retentionDay1)),
    retentionDay7: average(records.map((record) => record.retentionDay7)),
  };
}

function percentDelta(current: number, baseline: number) {
  if (!baseline) return 0;
  return ((current - baseline) / baseline) * 100;
}

function scopeSummaryTemplate(
  scope: 'channel' | 'agent',
  label: string,
  parentLabel: string | undefined,
  current: ReturnType<typeof summarize>,
  trailing7d: ReturnType<typeof summarize>,
  previousWeek: ReturnType<typeof summarize>,
  peerAverage: ReturnType<typeof summarize>,
  paceGap: number
) {
  if (scope === 'channel') {
    const cpaVs7d = percentDelta(current.activationCost, trailing7d.activationCost);
    const cpaVsWeek = percentDelta(current.activationCost, previousWeek.activationCost);
    const vsPeers = percentDelta(current.activationCost, peerAverage.activationCost);
    const retentionLead = current.retentionDay1 - peerAverage.retentionDay1;
    const activationShare = peerAverage.activations > 0 ? (current.activations / (peerAverage.activations * 5)) * 100 : 0;

    if (cpaVs7d > 10) {
      return `${label}成本控制承压，今日激活成本 ${current.activationCost.toFixed(2)}，较近7日均值恶化 ${cpaVs7d.toFixed(0)}%，较上周同期恶化 ${cpaVsWeek.toFixed(0)}%。`;
    }
    if (vsPeers < -8) {
      return `${label}今日效率领先，激活成本 ${current.activationCost.toFixed(2)}，较其他渠道平均低 ${Math.abs(vsPeers).toFixed(0)}%，同时次留率高出 ${retentionLead.toFixed(1)} 个点。`;
    }
    if (current.retentionDay7 < trailing7d.retentionDay7 - 1.2) {
      return `${label}量级贡献突出，今日激活占全盘约 ${activationShare.toFixed(0)}%，但7留率较近7日均值低 ${(trailing7d.retentionDay7 - current.retentionDay7).toFixed(1)} 个点，需警惕后链路质量。`;
    }
    return `${label}当前预算执行偏慢，实际消耗占本周应执行进度低 ${Math.max(0, paceGap).toFixed(0)}%，如持续将影响周目标达成。`;
  }

  const vsChannelAvg = current.retentionDay1 - peerAverage.retentionDay1;
  const cpaLead = percentDelta(current.activationCost, peerAverage.activationCost);
  const vsSelf7d = percentDelta(current.activationCost, trailing7d.activationCost);
  const activationLift = percentDelta(current.activations, trailing7d.activations);
  const d7Gap = current.retentionDay7 - peerAverage.retentionDay7;

  if (vsChannelAvg > 1.2 && cpaLead < -5) {
    return `${parentLabel}内部，${label}表现最佳，次留率 ${current.retentionDay1.toFixed(1)}%，较渠道内代理均值高 ${vsChannelAvg.toFixed(1)} 个点，激活成本低 ${Math.abs(cpaLead).toFixed(0)}%。`;
  }
  if (vsSelf7d > 8) {
    return `${parentLabel}内部，${label}成本控制失衡，激活成本 ${current.activationCost.toFixed(2)}，较渠道内均值高 ${Math.max(0, cpaLead).toFixed(0)}%，且较自身近7日恶化 ${vsSelf7d.toFixed(0)}%。`;
  }
  if (activationLift > 8) {
    return `${parentLabel}内部，${label}放量效率较好，激活量较近7日均值提升 ${activationLift.toFixed(0)}%，同时成本未明显走坏。`;
  }
  return `${parentLabel}内部，${label}留存端拖累明显，7留率较渠道内均值低 ${Math.abs(d7Gap).toFixed(1)} 个点，需优先调整素材或人群。`;
}

function buildScopeRecords(
  records: PerformanceRecord[],
  scope: 'channel' | 'agent'
): ScopeRecord[] {
  const grouped = new Map<string, ScopeRecord>();

  records.forEach((record) => {
    const key = scope === 'channel' ? record.channelId : record.agentId;
    const label = scope === 'channel' ? record.channelName : record.agentName;
    const existing = grouped.get(key) || {
      scopeId: key,
      scopeLabel: label,
      parentLabel: scope === 'agent' ? record.channelName : undefined,
      records: [],
    };
    existing.records.push(record);
    grouped.set(key, existing);
  });

  return Array.from(grouped.values());
}

export function buildOverviewInsights(
  scope: 'channel' | 'agent',
  history: PerformanceRecord[],
  strategy: WeeklyConstraintSet,
  plan: AllocationPlanVersion | null
): PerformanceInsight[] {
  const weekStart = dayjs(strategy.weekStart);
  const weekEnd = dayjs(strategy.weekEnd);
  const currentWeekRecords = history.filter((record) => {
    const date = dayjs(record.date);
    return (date.isAfter(weekStart.subtract(1, 'day')) && date.isBefore(weekEnd.add(1, 'day')));
  });
  const grouped = buildScopeRecords(currentWeekRecords, scope);

  return grouped.map((group) => {
    const current = summarize(group.records);
    const trailing7d = summarize(history.filter((record) => {
      const date = dayjs(record.date);
      const inWindow = date.isAfter(weekEnd.subtract(7, 'day')) && !date.isAfter(weekEnd, 'day');
      return inWindow && (scope === 'channel' ? record.channelId === group.scopeId : record.agentId === group.scopeId);
    }));
    const previousWeek = summarize(history.filter((record) => {
      const date = dayjs(record.date);
      const inWindow = date.isAfter(weekStart.subtract(8, 'day')) && date.isBefore(weekStart, 'day');
      return inWindow && (scope === 'channel' ? record.channelId === group.scopeId : record.agentId === group.scopeId);
    }));

    const peerGroup = grouped.filter((item) => item.scopeId !== group.scopeId);
    const peerAverage = summarize(peerGroup.flatMap((item) => item.records));
    const plannedSpend = scope === 'channel'
      ? plan?.channelAllocations.find((item) => item.channelId === group.scopeId)?.budgetAmount || 0
      : plan?.agentAllocations.find((item) => item.agentId === group.scopeId)?.budgetAmount || 0;
    const currentSpend = current.cost;
    const elapsedDays = Math.max(1, dayjs().diff(weekStart, 'day') + 1);
    const totalDays = Math.max(1, weekEnd.diff(weekStart, 'day') + 1);
    const expectedSpend = plannedSpend * (elapsedDays / totalDays);
    const paceGap = expectedSpend > 0 ? ((expectedSpend - currentSpend) / expectedSpend) * 100 : 0;

    const warningCount = [
      current.activationCost > trailing7d.activationCost * 1.08,
      current.retentionDay1 < strategy.minRetentionDay1,
      current.retentionDay7 < strategy.minRetentionDay7,
      current.activations < strategy.minActivations / 5,
    ].filter(Boolean).length;

    return {
      id: `${scope}-${group.scopeId}`,
      scope,
      scopeId: group.scopeId,
      scopeLabel: group.scopeLabel,
      parentLabel: group.parentLabel,
      rank: 0,
      summary: scopeSummaryTemplate(scope, group.scopeLabel, group.parentLabel, current, trailing7d, previousWeek, peerAverage, paceGap),
      warningCount,
      metrics: current,
      vsPreviousWeekActivationCost: percentDelta(current.activationCost, previousWeek.activationCost),
      vsTrailing7dActivationCost: percentDelta(current.activationCost, trailing7d.activationCost),
      vsPeersActivationCost: percentDelta(current.activationCost, peerAverage.activationCost),
      vsPeersRetentionDay1: current.retentionDay1 - peerAverage.retentionDay1,
      paceGap,
    };
  }).sort((left, right) => (
    right.metrics.activations / Math.max(right.metrics.activationCost, 1) -
    left.metrics.activations / Math.max(left.metrics.activationCost, 1)
  )).map((item, index) => ({ ...item, rank: index + 1 }));
}
