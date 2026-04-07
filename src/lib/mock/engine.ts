import dayjs from 'dayjs';
import type { Agent, Channel } from '@/types/database';
import type {
  AgentAllocationResult,
  AllocationPlanVersion,
  ChannelAllocationResult,
  ChannelShareConstraint,
  ConstraintForecastStatus,
  PerformanceRecord,
  WeeklyConstraintSet,
} from '@/types/mock';

interface MetricBundle {
  cost: number;
  activations: number;
  activationCost: number;
  retentionDay1: number;
  retentionDay7: number;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildLookbackMetrics(records: PerformanceRecord[]): MetricBundle {
  const totalCost = sum(records.map((record) => record.cost));
  const totalActivations = sum(records.map((record) => record.activations));

  return {
    cost: totalCost,
    activations: totalActivations,
    activationCost: totalActivations > 0 ? totalCost / totalActivations : 999,
    retentionDay1: average(records.map((record) => record.retentionDay1)),
    retentionDay7: average(records.map((record) => record.retentionDay7)),
  };
}

function weightedWindowMetrics(records: PerformanceRecord[], endDate: string): MetricBundle {
  const end = dayjs(endDate);
  const windows = [
    { days: 7, weight: 0.5 },
    { days: 14, weight: 0.3 },
    { days: 28, weight: 0.2 },
  ];

  const weighted = windows.map((window) => {
    const scoped = records.filter((record) => {
      const date = dayjs(record.date);
      return !date.isAfter(end, 'day') && date.isAfter(end.subtract(window.days, 'day'), 'day');
    });

    return {
      weight: window.weight,
      metrics: buildLookbackMetrics(scoped),
    };
  });

  const weightedAverage = (key: keyof MetricBundle) => weighted.reduce(
    (total, item) => total + item.metrics[key] * item.weight,
    0
  );

  return {
    cost: weightedAverage('cost'),
    activations: weightedAverage('activations'),
    activationCost: weightedAverage('activationCost'),
    retentionDay1: weightedAverage('retentionDay1'),
    retentionDay7: weightedAverage('retentionDay7'),
  };
}

function scoreAgainstPeers(metric: number, peerAverage: number, lowerIsBetter = false) {
  if (peerAverage <= 0) return 1;
  const ratio = lowerIsBetter ? peerAverage / metric : metric / peerAverage;
  return clamp(ratio, 0.45, 1.8);
}

function buildChannelScores(records: PerformanceRecord[], channels: Channel[], weekEnd: string) {
  const metricsByChannel = channels.map((channel) => {
    const channelRecords = records.filter((record) => record.channelId === channel.id);
    return {
      channelId: channel.id,
      channelName: channel.name,
      metrics: weightedWindowMetrics(channelRecords, weekEnd),
      history: buildLookbackMetrics(channelRecords.filter((record) => dayjs(record.date).isBefore(dayjs(weekEnd).subtract(7, 'day'), 'day'))),
    };
  });

  const peerAverageCpa = average(metricsByChannel.map((item) => item.metrics.activationCost));
  const peerAverageActivations = average(metricsByChannel.map((item) => item.metrics.activations));
  const peerAverageDay1 = average(metricsByChannel.map((item) => item.metrics.retentionDay1));
  const peerAverageDay7 = average(metricsByChannel.map((item) => item.metrics.retentionDay7));

  return metricsByChannel.map((item) => {
    const score = (
      scoreAgainstPeers(item.metrics.activationCost, peerAverageCpa, true) *
      scoreAgainstPeers(item.metrics.activations, peerAverageActivations) *
      scoreAgainstPeers(item.metrics.retentionDay1, peerAverageDay1) *
      scoreAgainstPeers(item.metrics.retentionDay7, peerAverageDay7)
    );

    return {
      ...item,
      score,
      vsHistoryActivationCost: item.history.activationCost > 0
        ? ((item.metrics.activationCost - item.history.activationCost) / item.history.activationCost) * 100
        : 0,
      vsPeersActivationCost: peerAverageCpa > 0
        ? ((item.metrics.activationCost - peerAverageCpa) / peerAverageCpa) * 100
        : 0,
    };
  });
}

function allocateByShareConstraints(
  budget: number,
  scores: Array<{ channelId: string; score: number }>,
  constraints: ChannelShareConstraint[]
) {
  const minShareSum = sum(constraints.map((constraint) => constraint.minShare));
  if (minShareSum > 1) {
    return {
      allocations: constraints.map((constraint) => ({
        channelId: constraint.channelId,
        budgetAmount: budget * constraint.minShare,
        budgetShare: constraint.minShare,
      })),
      warnings: ['渠道最小占比之和大于 100%，已按输入继续演示，但需要重新设置。'],
    };
  }

  const allocationMap = new Map<string, number>();
  const warnings: string[] = [];

  constraints.forEach((constraint) => {
    allocationMap.set(constraint.channelId, budget * constraint.minShare);
  });

  let remainingBudget = budget - sum(Array.from(allocationMap.values()));
  const scoreMap = new Map(scores.map((item) => [item.channelId, item.score]));

  for (let safety = 0; safety < 20 && remainingBudget > 1; safety += 1) {
    const allocatable = constraints.filter((constraint) => {
      const currentShare = (allocationMap.get(constraint.channelId) || 0) / budget;
      return currentShare < constraint.maxShare - 0.0001;
    });

    if (allocatable.length === 0) {
      warnings.push('部分预算无法继续分配，因为所有渠道都已触达最大占比。');
      break;
    }

    const totalScore = sum(allocatable.map((constraint) => scoreMap.get(constraint.channelId) || 1));
    let distributed = 0;

    allocatable.forEach((constraint) => {
      const score = scoreMap.get(constraint.channelId) || 1;
      const rawShare = totalScore > 0 ? score / totalScore : 1 / allocatable.length;
      const currentAmount = allocationMap.get(constraint.channelId) || 0;
      const maxAmount = budget * constraint.maxShare;
      const desired = remainingBudget * rawShare;
      const grant = Math.min(desired, maxAmount - currentAmount);

      if (grant > 0) {
        allocationMap.set(constraint.channelId, currentAmount + grant);
        distributed += grant;
      }
    });

    if (distributed <= 0.5) {
      break;
    }

    remainingBudget -= distributed;
  }

  const allocations = constraints.map((constraint) => {
    const budgetAmount = Number((allocationMap.get(constraint.channelId) || 0).toFixed(2));
    return {
      channelId: constraint.channelId,
      budgetAmount,
      budgetShare: budget > 0 ? budgetAmount / budget : 0,
    };
  });

  return { allocations, warnings };
}

function allocateAgentsWithinChannel(
  channelId: string,
  channelBudget: number,
  records: PerformanceRecord[],
  agents: Agent[],
  weekEnd: string
) {
  const channelAgents = agents.filter((agent) => agent.is_active);
  const agentMetrics = channelAgents.map((agent) => {
    const agentRecords = records.filter((record) => record.channelId === channelId && record.agentId === agent.id);
    return {
      agentId: agent.id,
      agentName: agent.name,
      metrics: weightedWindowMetrics(agentRecords, weekEnd),
    };
  }).filter((item) => item.metrics.activations > 0);

  const averageCpa = average(agentMetrics.map((item) => item.metrics.activationCost));
  const averageActivations = average(agentMetrics.map((item) => item.metrics.activations));
  const averageDay1 = average(agentMetrics.map((item) => item.metrics.retentionDay1));
  const averageDay7 = average(agentMetrics.map((item) => item.metrics.retentionDay7));
  const explorationShare = agentMetrics.length > 0 ? Math.min(0.08, 0.4 / agentMetrics.length) : 0;

  const scored = agentMetrics.map((item) => ({
    ...item,
    score: (
      scoreAgainstPeers(item.metrics.activationCost, averageCpa, true) *
      scoreAgainstPeers(item.metrics.activations, averageActivations) *
      scoreAgainstPeers(item.metrics.retentionDay1, averageDay1) *
      scoreAgainstPeers(item.metrics.retentionDay7, averageDay7)
    ),
  }));

  const baseBudget = channelBudget * explorationShare;
  const remainingBudget = channelBudget - baseBudget * scored.length;
  const totalScore = sum(scored.map((item) => item.score));

  return scored
    .map((item) => {
      const performanceShare = totalScore > 0 ? item.score / totalScore : 1 / Math.max(scored.length, 1);
      const budgetAmount = baseBudget + remainingBudget * performanceShare;

      return {
        ...item,
        budgetAmount,
        averageCpa,
        averageDay1,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function buildConstraintStatuses(
  strategy: WeeklyConstraintSet,
  totalBudget: number,
  predictedActivations: number,
  predictedRetentionDay1: number,
  predictedRetentionDay7: number
): ConstraintForecastStatus[] {
  return [
    {
      key: 'budget',
      label: '预算上限',
      target: strategy.budgetUpperBound,
      actual: totalBudget,
      met: totalBudget <= strategy.budgetUpperBound,
      delta: totalBudget - strategy.budgetUpperBound,
    },
    {
      key: 'activations',
      label: '激活量下限',
      target: strategy.minActivations,
      actual: predictedActivations,
      met: predictedActivations >= strategy.minActivations,
      delta: predictedActivations - strategy.minActivations,
    },
    {
      key: 'retention_day1',
      label: '次留率下限',
      target: strategy.minRetentionDay1,
      actual: predictedRetentionDay1,
      met: predictedRetentionDay1 >= strategy.minRetentionDay1,
      delta: predictedRetentionDay1 - strategy.minRetentionDay1,
    },
    {
      key: 'retention_day7',
      label: '7留率下限',
      target: strategy.minRetentionDay7,
      actual: predictedRetentionDay7,
      met: predictedRetentionDay7 >= strategy.minRetentionDay7,
      delta: predictedRetentionDay7 - strategy.minRetentionDay7,
    },
  ];
}

export function generateAllocationPlan(
  strategy: WeeklyConstraintSet,
  records: PerformanceRecord[],
  channels: Channel[],
  agents: Agent[],
  previousVersions: AllocationPlanVersion[],
  reason: string
): AllocationPlanVersion {
  const channelScores = buildChannelScores(records, channels.filter((channel) => channel.is_active), strategy.weekEnd);
  const { allocations, warnings: shareWarnings } = allocateByShareConstraints(
    strategy.budgetUpperBound,
    channelScores.map((item) => ({ channelId: item.channelId, score: item.score })),
    strategy.channelShareConstraints
  );

  const channelAllocations: ChannelAllocationResult[] = allocations.map((allocation) => {
    const channelScore = channelScores.find((item) => item.channelId === allocation.channelId);
    const predictedActivations = channelScore && channelScore.metrics.activationCost > 0
      ? allocation.budgetAmount / channelScore.metrics.activationCost
      : 0;

    return {
      channelId: allocation.channelId,
      channelName: channelScore?.channelName || '未知渠道',
      score: Number((channelScore?.score || 0).toFixed(3)),
      budgetAmount: Number(allocation.budgetAmount.toFixed(2)),
      budgetShare: Number((allocation.budgetShare * 100).toFixed(2)),
      predictedActivations: Math.round(predictedActivations),
      predictedActivationCost: Number((channelScore?.metrics.activationCost || 0).toFixed(2)),
      predictedRetentionDay1: Number((channelScore?.metrics.retentionDay1 || 0).toFixed(2)),
      predictedRetentionDay7: Number((channelScore?.metrics.retentionDay7 || 0).toFixed(2)),
      vsHistoryActivationCost: Number((channelScore?.vsHistoryActivationCost || 0).toFixed(2)),
      vsPeersActivationCost: Number((channelScore?.vsPeersActivationCost || 0).toFixed(2)),
      rationale: `${channelScore?.channelName || '该渠道'}近 28 天综合评分 ${Number(channelScore?.score || 0).toFixed(2)}，激活成本 ${Number(channelScore?.metrics.activationCost || 0).toFixed(2)}，次留 ${Number(channelScore?.metrics.retentionDay1 || 0).toFixed(2)}%。`,
      constraintNotes: [
        `占比区间 ${(strategy.channelShareConstraints.find((item) => item.channelId === allocation.channelId)?.minShare || 0) * 100}% ~ ${(strategy.channelShareConstraints.find((item) => item.channelId === allocation.channelId)?.maxShare || 0) * 100}%`,
      ],
    };
  });

  const agentAllocations: AgentAllocationResult[] = channelAllocations.flatMap((channelAllocation) => {
    const rankedAgents = allocateAgentsWithinChannel(
      channelAllocation.channelId,
      channelAllocation.budgetAmount,
      records,
      agents.filter((agent) => agent.is_active && records.some((record) => record.agentId === agent.id && record.channelId === channelAllocation.channelId)),
      strategy.weekEnd
    );

    return rankedAgents.map((agentScore, index) => ({
      channelId: channelAllocation.channelId,
      channelName: channelAllocation.channelName,
      agentId: agentScore.agentId,
      agentName: agentScore.agentName,
      score: Number(agentScore.score.toFixed(3)),
      rank: index + 1,
      budgetAmount: Number(agentScore.budgetAmount.toFixed(2)),
      budgetShareWithinChannel: Number(((agentScore.budgetAmount / channelAllocation.budgetAmount) * 100).toFixed(2)),
      predictedActivations: Math.round(agentScore.budgetAmount / agentScore.metrics.activationCost),
      predictedActivationCost: Number(agentScore.metrics.activationCost.toFixed(2)),
      predictedRetentionDay1: Number(agentScore.metrics.retentionDay1.toFixed(2)),
      predictedRetentionDay7: Number(agentScore.metrics.retentionDay7.toFixed(2)),
      vsChannelAverageActivationCost: Number((((agentScore.metrics.activationCost - agentScore.averageCpa) / agentScore.averageCpa) * 100).toFixed(2)),
      vsChannelAverageRetentionDay1: Number((agentScore.metrics.retentionDay1 - agentScore.averageDay1).toFixed(2)),
      rationale: `${agentScore.agentName} 在 ${channelAllocation.channelName} 内排名第 ${index + 1}，激活成本 ${agentScore.metrics.activationCost.toFixed(2)}，次留 ${agentScore.metrics.retentionDay1.toFixed(2)}%。`,
    }));
  });

  const predictedActivations = sum(channelAllocations.map((item) => item.predictedActivations));
  const predictedRetentionDay1 = average(channelAllocations.map((item) => item.predictedRetentionDay1));
  const predictedRetentionDay7 = average(channelAllocations.map((item) => item.predictedRetentionDay7));
  const statuses = buildConstraintStatuses(
    strategy,
    strategy.budgetUpperBound,
    predictedActivations,
    predictedRetentionDay1,
    predictedRetentionDay7
  );
  const unmetStatuses = statuses.filter((status) => !status.met);
  const summary = unmetStatuses.length === 0
    ? `预计可满足本周四项约束，建议按当前方案执行并持续监控百度与快手波动。`
    : `预计仍有 ${unmetStatuses.length} 项约束无法完全满足，建议在周三前复查渠道占比或下调激活目标。`;

  return {
    id: `${strategy.id}-v${previousVersions.length + 1}`,
    strategyId: strategy.id,
    versionNumber: previousVersions.length + 1,
    createdAt: dayjs().toISOString(),
    reason,
    channelAllocations,
    agentAllocations,
    forecastSummary: {
      totalBudget: strategy.budgetUpperBound,
      predictedActivations,
      predictedActivationCost: predictedActivations > 0 ? Number((strategy.budgetUpperBound / predictedActivations).toFixed(2)) : 0,
      predictedRetentionDay1: Number(predictedRetentionDay1.toFixed(2)),
      predictedRetentionDay7: Number(predictedRetentionDay7.toFixed(2)),
      statuses,
      summary,
      warnings: [
        ...shareWarnings,
        ...unmetStatuses.map((status) => `${status.label}预计偏离 ${status.delta.toFixed(2)}`),
      ],
      requiresReallocation: unmetStatuses.length >= 2 || shareWarnings.length > 0,
    },
  };
}
