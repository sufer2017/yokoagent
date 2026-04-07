import dayjs from 'dayjs';
import type { AllocationPlanVersion, DailyReportSnapshot, PerformanceRecord, WeeklyConstraintSet } from '@/types/mock';
import { buildOverviewInsights } from './insights';

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(records: PerformanceRecord[]) {
  const cost = records.reduce((sum, record) => sum + record.cost, 0);
  const activations = records.reduce((sum, record) => sum + record.activations, 0);

  return {
    cost,
    activations,
    activationCost: activations > 0 ? cost / activations : 0,
    retentionDay1: average(records.map((record) => record.retentionDay1)),
    retentionDay7: average(records.map((record) => record.retentionDay7)),
  };
}

export function buildDailyReport(
  date: string,
  history: PerformanceRecord[],
  strategy: WeeklyConstraintSet,
  plan: AllocationPlanVersion | null
): DailyReportSnapshot {
  const records = history.filter((record) => record.date === date);
  const totals = summarize(records);
  const channelInsights = buildOverviewInsights('channel', history.filter((record) => dayjs(record.date).isBefore(dayjs(date).add(1, 'day'))), strategy, plan);
  const agentInsights = buildOverviewInsights('agent', history.filter((record) => dayjs(record.date).isBefore(dayjs(date).add(1, 'day'))), strategy, plan);

  const channelHighlights = channelInsights.slice(0, 2).map((item) => item.summary);
  const channelRisks = channelInsights.filter((item) => item.warningCount > 0).slice(0, 2).map((item) => item.summary);
  const agentHighlights = agentInsights.slice(0, 2).map((item) => item.summary);
  const agentRisks = agentInsights.filter((item) => item.warningCount > 0).slice(0, 2).map((item) => item.summary);
  const warnings = [...channelInsights, ...agentInsights]
    .filter((item) => item.warningCount > 0)
    .slice(0, 5)
    .map((item) => `${item.scopeLabel}存在 ${item.warningCount} 项风险，${item.summary}`);
  const shouldReallocate = Boolean(plan?.forecastSummary.requiresReallocation || warnings.length >= 4);
  const evidence = [
    `总消耗 ${totals.cost.toFixed(2)} 元，激活 ${totals.activations}，激活成本 ${totals.activationCost.toFixed(2)} 元。`,
    `次留 ${totals.retentionDay1.toFixed(2)}%，7留 ${totals.retentionDay7.toFixed(2)}%。`,
    plan ? `当前执行方案为第 ${plan.versionNumber} 版，预测摘要：${plan.forecastSummary.summary}` : '当前尚未生成周策略方案。',
  ];

  const headline = shouldReallocate
    ? `今日表现偏离周目标，建议在周中考虑重分配。`
    : `今日整体仍在可控区间，建议保持当前节奏并针对个别预警点微调。`;

  const markdown = [
    `# YokoAgent 日报 ${date}`,
    '',
    `## 一句话总览`,
    headline,
    '',
    `## 当日核心指标`,
    `- 总消耗：${totals.cost.toFixed(2)} 元`,
    `- 激活数：${totals.activations}`,
    `- 激活成本：${totals.activationCost.toFixed(2)} 元`,
    `- 次留率：${totals.retentionDay1.toFixed(2)}%`,
    `- 7留率：${totals.retentionDay7.toFixed(2)}%`,
    '',
    `## 渠道进步 TOP`,
    ...channelHighlights.map((item) => `- ${item}`),
    '',
    `## 渠道退步 TOP`,
    ...channelRisks.map((item) => `- ${item}`),
    '',
    `## 代理进步 TOP`,
    ...agentHighlights.map((item) => `- ${item}`),
    '',
    `## 代理退步 TOP`,
    ...agentRisks.map((item) => `- ${item}`),
    '',
    `## 关键预警`,
    ...(warnings.length > 0 ? warnings.map((item) => `- ${item}`) : ['- 暂无严重预警']),
    '',
    `## 是否建议周中重分配`,
    shouldReallocate ? '建议本周内重新审视渠道占比与代理预算。' : '暂不需要重分配，优先做点状调整。',
    '',
    `## 数据依据摘要`,
    ...evidence.map((item) => `- ${item}`),
  ].join('\n');

  return {
    date,
    headline,
    totals,
    channelHighlights,
    channelRisks,
    agentHighlights,
    agentRisks,
    warnings,
    shouldReallocate,
    evidence,
    markdown,
  };
}
