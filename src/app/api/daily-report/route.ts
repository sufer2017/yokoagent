import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import {
  buildRedlineFlags,
  metricValue,
  percentDelta,
  round2,
  round4,
  targetValue,
  toNumberOrNull,
  type AlertLike,
  type AlertMetricKey,
  type MetricRecordLike,
  type TargetLike,
} from '@/lib/admin/metrics';
import {
  buildMetricIssueHitMap,
  buildThresholdLookup,
  readOptionalAlertThresholdRows,
  type AlertThresholdLookup,
  type AlertThresholdSettingLike,
} from '@/lib/admin/alertThresholds';
import { latestTargetForRecord, readLocalDb, type LocalDailyRecord, type LocalDb } from '@/lib/local-db/store';

type IssueType = '日环比偏离' | '周同比偏离' | '考核值偏离';
type IssueMetric = '消耗' | '激活' | 'CPA' | '次留' | '7留';
type Unit = 'number' | 'percent';
type HighlightSeverity = 'critical' | 'high' | 'medium';

interface TargetRow extends TargetLike {
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  effective_date: string;
}

interface AlertRow extends AlertLike {
  id: string;
  daily_record_id: string;
  status?: string | null;
}

interface AlertIssueStatusRow {
  alert_result_id: string;
  issue_key: string;
  status: string;
}

interface SourceRecord extends MetricRecordLike {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  creative_type: string;
  promotion_goal: string;
  ctr: number | string | null;
  cvr: number | string | null;
  cpm: number | string | null;
}

interface ReportRow extends SourceRecord {
  alert_id: string;
  product_name: string;
  channel_name: string;
  agent_name: string;
  feishu_webhook: string;
  alert_status: string;
  cost: number;
  activations: number;
  cpa: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  target_cpa: number | null;
  target_retention_day1: number | null;
  target_retention_day7: number | null;
  cost_dod: number | null;
  cost_wow: number | null;
  activations_dod: number | null;
  activations_wow: number | null;
  cpa_dod: number | null;
  cpa_wow: number | null;
  cpa_target_deviation: number | null;
  retention_day1_dod: number | null;
  retention_day1_wow: number | null;
  retention_day1_target_deviation: number | null;
  retention_day7_dod: number | null;
  retention_day7_wow: number | null;
  retention_day7_target_deviation: number | null;
  redline_cpa: boolean;
  redline_retention_day1: boolean;
  redline_retention_day7: boolean;
}

interface HighlightItem {
  rank: number;
  alert_id: string;
  alert_status: string;
  issue_id: string;
  issue_key: string;
  issue_status: string;
  record_date: string;
  product_id: string;
  channel_id: string;
  agent_id: string;
  product_name: string;
  channel_name: string;
  creative_type: string;
  promotion_goal: string;
  agent_name: string;
  feishu_webhook: string;
  metric: IssueMetric;
  issue_type: IssueType;
  actual_value: number | null;
  baseline_value: number | null;
  deviation_pct: number | null;
  severity_score: number;
  severity: HighlightSeverity;
  summary_sentence: string;
  action: string;
  unit: Unit;
}

function parseList(searchParams: URLSearchParams, pluralKey: string, legacyKey: string) {
  const values = [
    ...searchParams.getAll(pluralKey),
    searchParams.get(pluralKey) || '',
    searchParams.get(legacyKey) || '',
  ];
  return Array.from(new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)));
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { name?: string } | null;
  return relation?.name || '';
}

function relationWebhook(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { feishu_webhook?: string | null } | null;
  return relation?.feishu_webhook || '';
}

function latestTarget(targets: TargetRow[], productId: string, agentId: string, channelId: string, creativeType: string, promotionGoal: string, recordDate: string) {
  return targets
    .filter((target) => (
      target.product_id === productId &&
      target.agent_id === agentId &&
      target.channel_id === channelId &&
      target.creative_type === creativeType &&
      target.promotion_goal === promotionGoal &&
      target.effective_date <= recordDate
    ))
    .sort((left, right) => right.effective_date.localeCompare(left.effective_date))[0] || null;
}

function fallbackDeviation(actual: number | null, target: number | null) {
  return round4(percentDelta(actual, target));
}

function baselineFromDeviation(actual: number | null, deviation: number | null) {
  if (actual == null || deviation == null || deviation === -100) return null;
  return round2(actual / (1 + deviation / 100));
}

function buildReportRow(
  record: SourceRecord,
  names: { productName: string; channelName: string; agentName: string; feishuWebhook: string },
  target: TargetLike | null,
  alert: AlertRow | null
): ReportRow {
  const cpa = round2(metricValue(record, 'cpa'));
  const day1 = round2(toNumberOrNull(record.retention_day1));
  const day7 = round2(toNumberOrNull(record.retention_day7));
  const targetCpa = round2(targetValue(target, 'cpa'));
  const targetDay1 = round2(targetValue(target, 'retention_day1'));
  const targetDay7 = round2(targetValue(target, 'retention_day7'));
  const redlines = buildRedlineFlags(record, target);

  return {
    ...record,
    alert_id: alert?.id || '',
    product_name: names.productName,
    channel_name: names.channelName,
    agent_name: names.agentName,
    feishu_webhook: names.feishuWebhook,
    alert_status: alert?.status || 'open',
    cost: round2(toNumberOrNull(record.cost)) || 0,
    activations: toNumberOrNull(record.activations) || 0,
    cpa,
    retention_day1: day1,
    retention_day7: day7,
    target_cpa: targetCpa,
    target_retention_day1: targetDay1,
    target_retention_day7: targetDay7,
    cost_dod: round4(toNumberOrNull(alert?.cost_dod)),
    cost_wow: round4(toNumberOrNull(alert?.cost_wow)),
    activations_dod: round4(toNumberOrNull(alert?.activations_dod)),
    activations_wow: round4(toNumberOrNull(alert?.activations_wow)),
    cpa_dod: round4(toNumberOrNull(alert?.cpa_dod)),
    cpa_wow: round4(toNumberOrNull(alert?.cpa_wow)),
    cpa_target_deviation: round4(toNumberOrNull(alert?.cpa_target_deviation)) ?? fallbackDeviation(cpa, targetCpa),
    retention_day1_dod: round4(toNumberOrNull(alert?.retention_day1_dod)),
    retention_day1_wow: round4(toNumberOrNull(alert?.retention_day1_wow)),
    retention_day1_target_deviation: round4(toNumberOrNull(alert?.retention_day1_target_deviation)) ?? fallbackDeviation(day1, targetDay1),
    retention_day7_dod: round4(toNumberOrNull(alert?.retention_day7_dod)),
    retention_day7_wow: round4(toNumberOrNull(alert?.retention_day7_wow)),
    retention_day7_target_deviation: round4(toNumberOrNull(alert?.retention_day7_target_deviation)) ?? fallbackDeviation(day7, targetDay7),
    redline_cpa: redlines.cpa,
    redline_retention_day1: redlines.retention_day1,
    redline_retention_day7: redlines.retention_day7,
  };
}

function valueForMetric(row: ReportRow, metric: AlertMetricKey) {
  if (metric === 'cost') return row.cost;
  if (metric === 'activations') return row.activations;
  if (metric === 'cpa') return row.cpa;
  if (metric === 'retention_day1') return row.retention_day1;
  return row.retention_day7;
}

function issueMetricName(metric: AlertMetricKey): IssueMetric {
  if (metric === 'cost') return '消耗';
  if (metric === 'activations') return '激活';
  if (metric === 'cpa') return 'CPA';
  if (metric === 'retention_day1') return '次留';
  return '7留';
}

function issueUnit(metric: AlertMetricKey): Unit {
  return metric === 'retention_day1' || metric === 'retention_day7' ? 'percent' : 'number';
}

function metricLabel(metric: AlertMetricKey) {
  if (metric === 'cost') return '消耗';
  if (metric === 'activations') return '激活';
  if (metric === 'cpa') return 'CPA';
  if (metric === 'retention_day1') return '次留';
  return '7留';
}

function valueText(value: number | null, unit: Unit) {
  if (value == null) return '-';
  if (unit === 'percent') return `${Number(value).toFixed(1)}%`;
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function pctText(value: number | null) {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function actionFor(metric: AlertMetricKey, type: IssueType, deviation: number | null) {
  if (metric === 'cost') {
    return (deviation || 0) > 0
      ? '建议优先核实是否主动放量、预算或素材策略调整，并确认投放违规风险。'
      : '建议优先核实预算、审核、账户状态和素材消耗。';
  }
  if (metric === 'activations') {
    return (deviation || 0) > 0
      ? '建议确认量级上涨是否符合计划，并同步检查成本和留存是否健康。'
      : '建议优先检查预算、素材、出价和账户状态。';
  }
  if (metric === 'cpa') {
    return type === '考核值偏离'
      ? '建议核实出价、流量结构和素材效率。'
      : '建议确认是否存在激进放量、流量质量变化或成本口径异常。';
  }
  return type === '考核值偏离'
    ? '建议核实留存低于考核原因，重点检查素材承诺、落地页和用户质量。'
    : '建议结合 CTR/CVR/CPM 判断素材和流量结构变化。';
}

function severityBase(metric: AlertMetricKey, issueType: IssueType) {
  if (metric === 'cost' || metric === 'activations') return 4000;
  if (metric === 'cpa') return issueType === '考核值偏离' ? 3100 : 3000;
  if (metric === 'retention_day1') return issueType === '考核值偏离' ? 2100 : 2000;
  return issueType === '考核值偏离' ? 1100 : 1000;
}

function issueTypeKey(issueType: IssueType) {
  if (issueType === '日环比偏离') return 'dod';
  if (issueType === '周同比偏离') return 'wow';
  return 'target_deviation';
}

function buildIssueKey(metric: AlertMetricKey, issueType: IssueType) {
  return `${metric}:${issueTypeKey(issueType)}`;
}

function buildIssueId(alertId: string, issueKey: string) {
  return `${alertId}:${issueKey}`;
}

function issueStatusFor(row: ReportRow, issueKey: string, issueStatusById: Map<string, string>) {
  if (!row.alert_id) return row.alert_status;
  return issueStatusById.get(buildIssueId(row.alert_id, issueKey)) || row.alert_status;
}

function summarySentence(row: ReportRow, metric: AlertMetricKey, issueType: IssueType, deviation: number | null, baseline: number | null) {
  const scope = `${row.product_name} / ${row.channel_name} / ${row.creative_type} / ${row.promotion_goal} / ${row.agent_name}`;
  const unit = issueUnit(metric);
  const actual = valueForMetric(row, metric);
  const label = metricLabel(metric);
  if (metric === 'cost' || metric === 'activations') {
    const direction = (deviation || 0) > 0 ? '激进放量' : '明显掉量';
    const compareBase = issueType === '周同比偏离' ? '较上周同日' : '较昨日';
    const baselineLabel = issueType === '周同比偏离' ? '上周同日基准' : '昨日基准';
    const compareText = metric === 'cost' ? `消耗${compareBase}` : `量级${compareBase}`;
    return `${scope}：${compareText}${direction} ${pctText(deviation)}，T-1 ${label} ${valueText(actual, unit)}，${baselineLabel} ${valueText(baseline, unit)}。`;
  }
  if (issueType === '考核值偏离') {
    const verb = metric === 'cpa' ? '高于考核' : '低于考核';
    return `${scope}：${label} ${verb} ${pctText(deviation)}，T-1 ${label} ${valueText(actual, unit)}，考核值 ${valueText(baseline, unit)}。`;
  }
  const compareText = issueType === '日环比偏离' ? '较昨日' : '较上周同日';
  const direction = metric === 'cpa' ? '上升' : '下滑';
  return `${scope}：${label}${compareText}${direction} ${pctText(deviation)}，T-1 ${label} ${valueText(actual, unit)}，基准值 ${valueText(baseline, unit)}。`;
}

function addHighlight(
  items: Omit<HighlightItem, 'rank'>[],
  row: ReportRow,
  metric: AlertMetricKey,
  issueType: IssueType,
  deviation: number | null,
  baseline: number | null,
  issueStatusById: Map<string, string>
) {
  const score = severityBase(metric, issueType) + Math.abs(deviation || 0);
  const unit = issueUnit(metric);
  const issueKey = buildIssueKey(metric, issueType);
  const issueStatus = issueStatusFor(row, issueKey, issueStatusById);
  items.push({
    alert_id: row.alert_id,
    alert_status: row.alert_status,
    issue_id: buildIssueId(row.alert_id, issueKey),
    issue_key: issueKey,
    issue_status: issueStatus,
    record_date: row.record_date,
    product_id: row.product_id,
    channel_id: row.channel_id,
    agent_id: row.agent_id,
    product_name: row.product_name,
    channel_name: row.channel_name,
    creative_type: row.creative_type,
    promotion_goal: row.promotion_goal,
    agent_name: row.agent_name,
    feishu_webhook: row.feishu_webhook,
    metric: issueMetricName(metric),
    issue_type: issueType,
    actual_value: valueForMetric(row, metric),
    baseline_value: baseline,
    deviation_pct: deviation,
    severity_score: Number(score.toFixed(4)),
    severity: score >= 4050 ? 'critical' : score >= 3000 ? 'high' : 'medium',
    summary_sentence: summarySentence(row, metric, issueType, deviation, baseline),
    action: actionFor(metric, issueType, deviation),
    unit,
  });
}

function matchesStatusFilter(alertStatus: string | null | undefined, filter: string | null) {
  if (!filter || filter === 'all') return true;
  if (filter === 'processed') return alertStatus === 'acknowledged' || alertStatus === 'resolved';
  return alertStatus === filter;
}

function buildHighlightItems(
  rows: ReportRow[],
  reportDate: string,
  status: string | null,
  issueStatusById: Map<string, string>,
  thresholdLookup: AlertThresholdLookup
) {
  const items: Omit<HighlightItem, 'rank'>[] = [];
  for (const row of rows.filter((item) => item.record_date === reportDate)) {
    const issueHits = buildMetricIssueHitMap(
      thresholdLookup,
      row.product_id,
      row.channel_id,
      row.creative_type,
      {
        cost_dod: row.cost_dod,
        cost_wow: row.cost_wow,
        activations_dod: row.activations_dod,
        activations_wow: row.activations_wow,
        cpa_target_deviation: row.cpa_target_deviation,
        cpa_dod: row.cpa_dod,
        cpa_wow: row.cpa_wow,
        retention_day1_dod: row.retention_day1_dod,
        retention_day1_wow: row.retention_day1_wow,
        retention_day1_target_deviation: row.retention_day1_target_deviation,
        retention_day7_dod: row.retention_day7_dod,
        retention_day7_wow: row.retention_day7_wow,
        retention_day7_target_deviation: row.retention_day7_target_deviation,
      }
    );
    if (issueHits.cost?.dod) {
      addHighlight(items, row, 'cost', '日环比偏离', row.cost_dod, baselineFromDeviation(row.cost, row.cost_dod), issueStatusById);
    }
    if (issueHits.cost?.wow) {
      addHighlight(items, row, 'cost', '周同比偏离', row.cost_wow, baselineFromDeviation(row.cost, row.cost_wow), issueStatusById);
    }
    if (issueHits.activations?.dod) {
      addHighlight(items, row, 'activations', '日环比偏离', row.activations_dod, baselineFromDeviation(row.activations, row.activations_dod), issueStatusById);
    }
    if (issueHits.activations?.wow) {
      addHighlight(items, row, 'activations', '周同比偏离', row.activations_wow, baselineFromDeviation(row.activations, row.activations_wow), issueStatusById);
    }
    if (issueHits.cpa?.target_deviation) {
      addHighlight(items, row, 'cpa', '考核值偏离', row.cpa_target_deviation, row.target_cpa, issueStatusById);
    }
    if (issueHits.cpa?.dod) {
      addHighlight(items, row, 'cpa', '日环比偏离', row.cpa_dod, baselineFromDeviation(row.cpa, row.cpa_dod), issueStatusById);
    }
    if (issueHits.cpa?.wow) {
      addHighlight(items, row, 'cpa', '周同比偏离', row.cpa_wow, baselineFromDeviation(row.cpa, row.cpa_wow), issueStatusById);
    }
    if (issueHits.retention_day1?.target_deviation) {
      addHighlight(items, row, 'retention_day1', '考核值偏离', row.retention_day1_target_deviation, row.target_retention_day1, issueStatusById);
    }
    if (issueHits.retention_day1?.dod) {
      addHighlight(items, row, 'retention_day1', '日环比偏离', row.retention_day1_dod, baselineFromDeviation(row.retention_day1, row.retention_day1_dod), issueStatusById);
    }
    if (issueHits.retention_day1?.wow) {
      addHighlight(items, row, 'retention_day1', '周同比偏离', row.retention_day1_wow, baselineFromDeviation(row.retention_day1, row.retention_day1_wow), issueStatusById);
    }
    if (issueHits.retention_day7?.target_deviation) {
      addHighlight(items, row, 'retention_day7', '考核值偏离', row.retention_day7_target_deviation, row.target_retention_day7, issueStatusById);
    }
    if (issueHits.retention_day7?.dod) {
      addHighlight(items, row, 'retention_day7', '日环比偏离', row.retention_day7_dod, baselineFromDeviation(row.retention_day7, row.retention_day7_dod), issueStatusById);
    }
    if (issueHits.retention_day7?.wow) {
      addHighlight(items, row, 'retention_day7', '周同比偏离', row.retention_day7_wow, baselineFromDeviation(row.retention_day7, row.retention_day7_wow), issueStatusById);
    }
  }

  return items
    .filter((item) => matchesStatusFilter(item.issue_status, status))
    .sort((left, right) => (
      right.severity_score - left.severity_score ||
      left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
      left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
      left.creative_type.localeCompare(right.creative_type, 'zh-Hans-CN') ||
      left.promotion_goal.localeCompare(right.promotion_goal, 'zh-Hans-CN') ||
      left.agent_name.localeCompare(right.agent_name, 'zh-Hans-CN')
    ))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildResponse(
  rows: ReportRow[],
  reportDate: string,
  status: string | null,
  issueStatusById: Map<string, string>,
  thresholdLookup: AlertThresholdLookup
) {
  const highlightItems = buildHighlightItems(rows, reportDate, status, issueStatusById, thresholdLookup);
  return {
    reportDate,
    highlightItems,
    totalIssueCount: highlightItems.length,
  };
}

function localReportRows(db: LocalDb, rows: LocalDailyRecord[], alertByRecordId: Map<string, AlertRow>) {
  return rows.map((record) => {
    const agent = db.agents.find((item) => item.id === record.agent_id);
    const channel = db.channels.find((item) => item.id === record.channel_id);
    const product = db.products.find((item) => item.id === record.product_id);
    return buildReportRow(
      record,
      {
        productName: product?.name || '',
        channelName: channel?.name || '',
        agentName: agent?.name || '',
        feishuWebhook: agent?.feishu_webhook || '',
      },
      latestTargetForRecord(db, record.agent_id, record.channel_id, record.record_date, record.product_id, record.creative_type, record.promotion_goal),
      alertByRecordId.get(record.id) || null
    );
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (session.role !== 'admin' && session.role !== 'agent') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (session.role === 'agent' && (!session.agentId || !session.productId || !session.channelId)) {
      return NextResponse.json({ success: false, error: 'Agent scope missing' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const reportDate = searchParams.get('dateTo') || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const status = searchParams.get('status');
    let productIds = parseList(searchParams, 'productIds', 'productId');
    let channelIds = parseList(searchParams, 'channelIds', 'channelId');
    let agentIds = parseList(searchParams, 'agentIds', 'agentId');
    const creativeTypes = parseList(searchParams, 'creativeTypes', 'creativeType');
    const promotionGoals = parseList(searchParams, 'promotionGoals', 'promotionGoal');

    if (session.role === 'agent') {
      productIds = [session.productId!];
      channelIds = [session.channelId!];
      agentIds = [session.agentId!];
    }

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const alertByRecordId = new Map(db.alert_results.map((alert) => [alert.daily_record_id, alert]));
      const issueStatusById = new Map(db.alert_issue_statuses.map((item) => [
        buildIssueId(item.alert_result_id, item.issue_key),
        item.status,
      ]));
      const rows = db.daily_records
        .filter((record) => record.record_date === reportDate)
        .filter((record) => productIds.length === 0 || productIds.includes(record.product_id))
        .filter((record) => channelIds.length === 0 || channelIds.includes(record.channel_id))
        .filter((record) => agentIds.length === 0 || agentIds.includes(record.agent_id))
        .filter((record) => creativeTypes.length === 0 || creativeTypes.includes(record.creative_type))
        .filter((record) => promotionGoals.length === 0 || promotionGoals.includes(record.promotion_goal));

      return NextResponse.json({
        success: true,
        data: buildResponse(
          localReportRows(db, rows, alertByRecordId),
          reportDate,
          status,
          issueStatusById,
          buildThresholdLookup(db.alert_threshold_settings)
        ),
      });
    }

    const supabase = createServerSupabase();
    let recordsQuery = supabase
      .from('daily_records')
      .select('id, agent_id, product_id, channel_id, record_date, creative_type, promotion_goal, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7, agents(name, feishu_webhook), products(name), channels(name)')
      .eq('record_date', reportDate);

    if (productIds.length > 0) recordsQuery = recordsQuery.in('product_id', productIds);
    if (channelIds.length > 0) recordsQuery = recordsQuery.in('channel_id', channelIds);
    if (agentIds.length > 0) recordsQuery = recordsQuery.in('agent_id', agentIds);
    if (creativeTypes.length > 0) recordsQuery = recordsQuery.in('creative_type', creativeTypes);
    if (promotionGoals.length > 0) recordsQuery = recordsQuery.in('promotion_goal', promotionGoals);

    let targetsQuery = supabase
      .from('target_changes')
      .select('agent_id, product_id, channel_id, creative_type, promotion_goal, effective_date, target_cpa, target_retention_day1, target_retention_day7, activation_cap')
      .lte('effective_date', reportDate)
      .order('effective_date', { ascending: false });
    if (productIds.length > 0) targetsQuery = targetsQuery.in('product_id', productIds);
    if (channelIds.length > 0) targetsQuery = targetsQuery.in('channel_id', channelIds);
    if (agentIds.length > 0) targetsQuery = targetsQuery.in('agent_id', agentIds);
    if (creativeTypes.length > 0) targetsQuery = targetsQuery.in('creative_type', creativeTypes);
    if (promotionGoals.length > 0) targetsQuery = targetsQuery.in('promotion_goal', promotionGoals);

    let thresholdsQuery = supabase
      .from('alert_threshold_settings')
      .select('product_id, channel_id, creative_type, metric_key, upper_threshold, lower_threshold');
    if (productIds.length > 0) thresholdsQuery = thresholdsQuery.in('product_id', productIds);
    if (channelIds.length > 0) thresholdsQuery = thresholdsQuery.in('channel_id', channelIds);
    if (creativeTypes.length > 0) thresholdsQuery = thresholdsQuery.in('creative_type', creativeTypes);

    const [recordsRes, targetsRes, thresholdRows] = await Promise.all([
      recordsQuery,
      targetsQuery,
      readOptionalAlertThresholdRows<AlertThresholdSettingLike>(thresholdsQuery),
    ]);
    if (recordsRes.error) throw recordsRes.error;
    if (targetsRes.error) throw targetsRes.error;

    const recordIds = ((recordsRes.data || []) as Array<Record<string, unknown>>).map((row) => String(row.id));
    const alertsRes = recordIds.length > 0
      ? await supabase
        .from('alert_results')
        .select('id, daily_record_id, status, cost_dod, cost_wow, activations_dod, activations_wow, cpa_dod, cpa_wow, cpa_target_deviation, retention_day1_dod, retention_day1_wow, retention_day1_target_deviation, retention_day7_dod, retention_day7_wow, retention_day7_target_deviation')
        .in('daily_record_id', recordIds)
      : { data: [], error: null };
    if (alertsRes.error) throw alertsRes.error;

    const alertIds = ((alertsRes.data || []) as AlertRow[]).map((alert) => alert.id);
    const issueStatusesRes = alertIds.length > 0
      ? await supabase
        .from('alert_issue_statuses')
        .select('alert_result_id, issue_key, status')
        .in('alert_result_id', alertIds)
      : { data: [], error: null };
    if (issueStatusesRes.error) throw issueStatusesRes.error;

    const targets = (targetsRes.data || []) as TargetRow[];
    const alertByRecordId = new Map(((alertsRes.data || []) as AlertRow[]).map((alert) => [alert.daily_record_id, alert]));
    const issueStatusById = new Map(((issueStatusesRes.data || []) as AlertIssueStatusRow[]).map((item) => [
      buildIssueId(item.alert_result_id, item.issue_key),
      item.status,
    ]));
    const rows = ((recordsRes.data || []) as Array<Record<string, unknown>>).map((row) => {
      const source: SourceRecord = {
        id: String(row.id),
        agent_id: String(row.agent_id),
        product_id: String(row.product_id),
        channel_id: String(row.channel_id),
        record_date: String(row.record_date),
        creative_type: String(row.creative_type || ''),
        promotion_goal: String(row.promotion_goal || ''),
        cost: row.cost as number | string | null,
        activations: row.activations as number | string | null,
        cpa: row.cpa as number | string | null,
        ctr: row.ctr as number | string | null,
        cvr: row.cvr as number | string | null,
        cpm: row.cpm as number | string | null,
        retention_day1: row.retention_day1 as number | string | null,
        retention_day7: row.retention_day7 as number | string | null,
      };
      return buildReportRow(
        source,
        {
          productName: relationName(row.products),
          channelName: relationName(row.channels),
          agentName: relationName(row.agents),
          feishuWebhook: relationWebhook(row.agents),
        },
        latestTarget(targets, source.product_id, source.agent_id, source.channel_id, source.creative_type, source.promotion_goal, source.record_date),
        alertByRecordId.get(source.id) || null
      );
    });

    return NextResponse.json({
      success: true,
      data: buildResponse(
        rows,
        reportDate,
        status,
        issueStatusById,
        buildThresholdLookup(thresholdRows)
      ),
    });
  } catch (error) {
    console.error('GET /api/daily-report error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch daily report' }, { status: 500 });
  }
}
