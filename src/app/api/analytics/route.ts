import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import {
  buildRedlineFlags,
  listDates,
  metricValue,
  percentDelta,
  round2,
  round4,
  targetValue,
  toNumberOrNull,
  weightedAverage,
  type TargetLike,
} from '@/lib/admin/metrics';
import { defaultBusinessAnchorDate } from '@/lib/admin/dates';
import { latestTargetForRecord, readLocalDb, type LocalDailyRecord, type LocalDb } from '@/lib/local-db/store';

type MetricFilterKey = 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7';
type MetricOperator = '<' | '<=' | '=' | '>' | '>=';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const SUPABASE_FETCH_CHUNK_SIZE = 1000;
const MAX_ANALYTICS_ROWS = 100000;

interface MetricFilter {
  metric: MetricFilterKey;
  operator: MetricOperator;
  value: number;
}

interface TargetRow extends TargetLike {
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  effective_date: string;
}

interface AlertRow {
  daily_record_id: string;
  cost_dod: number | string | null;
  activations_dod: number | string | null;
  cpa_dod: number | string | null;
  cpa_wow: number | string | null;
  cpa_target_deviation: number | string | null;
  retention_day1_dod: number | string | null;
  retention_day1_wow: number | string | null;
  retention_day1_target_deviation: number | string | null;
  retention_day7_dod: number | string | null;
  retention_day7_wow: number | string | null;
  retention_day7_target_deviation: number | string | null;
}

interface SourceRecord {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  creative_type: string;
  promotion_goal: string;
  cost: number | string | null;
  activations: number | string | null;
  cpa: number | string | null;
  ctr: number | string | null;
  cvr: number | string | null;
  cpm: number | string | null;
  retention_day1: number | string | null;
  retention_day7: number | string | null;
}

interface DetailRow {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  product_name: string;
  channel_name: string;
  agent_name: string;
  creative_type: string;
  promotion_goal: string;
  cost: number;
  cost_dod: number | null;
  activations: number;
  activations_dod: number | null;
  cpa: number | null;
  target_cpa: number | null;
  cpa_dod: number | null;
  cpa_wow: number | null;
  cpa_target_deviation: number | null;
  retention_day1: number | null;
  target_retention_day1: number | null;
  retention_day1_dod: number | null;
  retention_day1_wow: number | null;
  retention_day1_target_deviation: number | null;
  retention_day7: number | null;
  target_retention_day7: number | null;
  retention_day7_dod: number | null;
  retention_day7_wow: number | null;
  retention_day7_target_deviation: number | null;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  activation_cap: number | null;
  redline_cpa: boolean;
  redline_retention_day1: boolean;
  redline_retention_day7: boolean;
  redline_count: number;
  has_redline: boolean;
  isSummary?: boolean;
  summaryCount?: number;
  cpaRedlineCount?: number;
  day1RedlineCount?: number;
  day7RedlineCount?: number;
}

interface PaginationInput {
  page: number;
  pageSize: number;
}

function parseList(searchParams: URLSearchParams, pluralKey: string, legacyKey: string) {
  const values = [
    ...searchParams.getAll(pluralKey),
    searchParams.get(pluralKey) || '',
    searchParams.get(legacyKey) || '',
  ];
  return Array.from(new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)));
}

function parseMetricFilters(raw: string | null): MetricFilter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<MetricFilter>>;
    return parsed
      .filter((item) => (
        ['cost', 'activations', 'cpa', 'retention_day1', 'retention_day7'].includes(String(item.metric)) &&
        ['<', '<=', '=', '>', '>='].includes(String(item.operator)) &&
        Number.isFinite(Number(item.value))
      ))
      .map((item) => ({
        metric: item.metric as MetricFilterKey,
        operator: item.operator as MetricOperator,
        value: Number(item.value),
      }));
  } catch {
    return [];
  }
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

function parsePagination(searchParams: URLSearchParams): PaginationInput {
  return {
    page: parsePositiveInteger(searchParams.get('page'), 1),
    pageSize: Math.min(parsePositiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
  };
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { name?: string } | null;
  return relation?.name || '';
}

function relationIsActive(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { is_active?: boolean } | null;
  return relation?.is_active !== false;
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

function metricFilterValue(row: DetailRow, metric: MetricFilterKey) {
  if (metric === 'cost') return row.cost;
  if (metric === 'activations') return row.activations;
  if (metric === 'cpa') return row.cpa;
  if (metric === 'retention_day1') return row.retention_day1;
  return row.retention_day7;
}

function compareMetric(value: number | null, operator: MetricOperator, target: number) {
  if (value == null) return false;
  if (operator === '<') return value < target;
  if (operator === '<=') return value <= target;
  if (operator === '>') return value > target;
  if (operator === '>=') return value >= target;
  return Math.abs(value - target) < 0.000001;
}

function applyMetricFilters(rows: DetailRow[], filters: MetricFilter[]) {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((filter) => compareMetric(metricFilterValue(row, filter.metric), filter.operator, filter.value)));
}

function fallbackDeviation(actual: number | null, target: number | null) {
  return round4(percentDelta(actual, target));
}

function buildDetailRow(
  record: SourceRecord,
  names: { agentName: string; productName: string; channelName: string },
  target: TargetLike | null,
  alert: AlertRow | null
): DetailRow {
  const cpa = round2(metricValue(record, 'cpa'));
  const day1 = round2(toNumberOrNull(record.retention_day1));
  const day7 = round2(toNumberOrNull(record.retention_day7));
  const targetCpa = round2(targetValue(target, 'cpa'));
  const targetDay1 = round2(targetValue(target, 'retention_day1'));
  const targetDay7 = round2(targetValue(target, 'retention_day7'));
  const redlines = buildRedlineFlags(record, target);

  return {
    id: record.id,
    agent_id: record.agent_id,
    product_id: record.product_id,
    channel_id: record.channel_id,
    record_date: record.record_date,
    product_name: names.productName,
    channel_name: names.channelName,
    agent_name: names.agentName,
    creative_type: record.creative_type,
    promotion_goal: record.promotion_goal,
    cost: round2(toNumberOrNull(record.cost)) || 0,
    cost_dod: round4(toNumberOrNull(alert?.cost_dod)),
    activations: toNumberOrNull(record.activations) || 0,
    activations_dod: round4(toNumberOrNull(alert?.activations_dod)),
    cpa,
    target_cpa: targetCpa,
    cpa_dod: round4(toNumberOrNull(alert?.cpa_dod)),
    cpa_wow: round4(toNumberOrNull(alert?.cpa_wow)),
    cpa_target_deviation: round4(toNumberOrNull(alert?.cpa_target_deviation)) ?? fallbackDeviation(cpa, targetCpa),
    retention_day1: day1,
    target_retention_day1: targetDay1,
    retention_day1_dod: round4(toNumberOrNull(alert?.retention_day1_dod)),
    retention_day1_wow: round4(toNumberOrNull(alert?.retention_day1_wow)),
    retention_day1_target_deviation: round4(toNumberOrNull(alert?.retention_day1_target_deviation)) ?? fallbackDeviation(day1, targetDay1),
    retention_day7: day7,
    target_retention_day7: targetDay7,
    retention_day7_dod: round4(toNumberOrNull(alert?.retention_day7_dod)),
    retention_day7_wow: round4(toNumberOrNull(alert?.retention_day7_wow)),
    retention_day7_target_deviation: round4(toNumberOrNull(alert?.retention_day7_target_deviation)) ?? fallbackDeviation(day7, targetDay7),
    ctr: round2(toNumberOrNull(record.ctr)),
    cvr: round2(toNumberOrNull(record.cvr)),
    cpm: round2(toNumberOrNull(record.cpm)),
    activation_cap: round2(toNumberOrNull(target?.activation_cap)),
    redline_cpa: redlines.cpa,
    redline_retention_day1: redlines.retention_day1,
    redline_retention_day7: redlines.retention_day7,
    redline_count: redlines.count,
    has_redline: redlines.has_redline,
  };
}

function summarizeRows(rows: DetailRow[]) {
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalActivations = rows.reduce((sum, row) => sum + row.activations, 0);
  return {
    totalCost: round2(totalCost) || 0,
    totalActivations,
    cpa: round2(totalActivations > 0 ? totalCost / totalActivations : null),
    retentionDay1: round2(weightedAverage(rows, 'retention_day1')),
    retentionDay7: round2(weightedAverage(rows, 'retention_day7')),
  };
}

function lineValue(rows: DetailRow[], metric: 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7' | 'cpaAlerts' | 'day1Alerts' | 'day7Alerts') {
  if (metric === 'cost') return summarizeRows(rows).totalCost;
  if (metric === 'activations') return summarizeRows(rows).totalActivations;
  if (metric === 'cpa') return summarizeRows(rows).cpa;
  if (metric === 'retention_day1') return summarizeRows(rows).retentionDay1;
  if (metric === 'retention_day7') return summarizeRows(rows).retentionDay7;
  if (metric === 'cpaAlerts') return rows.filter((row) => row.redline_cpa).length;
  if (metric === 'day1Alerts') return rows.filter((row) => row.redline_retention_day1).length;
  return rows.filter((row) => row.redline_retention_day7).length;
}

function buildChart(
  rows: DetailRow[],
  dates: string[],
  metric: Parameters<typeof lineValue>[1],
  channelNames: string[]
) {
  return dates.flatMap((date) => {
    const dayRows = rows.filter((row) => row.record_date === date);
    const entries = [{
      date,
      dateLabel: dayjs(date).format('MM-DD'),
      series: '汇总',
      value: lineValue(dayRows, metric),
    }];

    for (const channelName of channelNames) {
      const channelRows = dayRows.filter((row) => row.channel_name === channelName);
      entries.push({
        date,
        dateLabel: dayjs(date).format('MM-DD'),
        series: channelName,
        value: lineValue(channelRows, metric),
      });
    }
    return entries;
  });
}

function sortDetailRows(rows: DetailRow[]) {
  return [...rows].sort((left, right) => (
    right.record_date.localeCompare(left.record_date) ||
    left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
    left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
    left.creative_type.localeCompare(right.creative_type, 'zh-Hans-CN') ||
    left.promotion_goal.localeCompare(right.promotion_goal, 'zh-Hans-CN') ||
    left.agent_name.localeCompare(right.agent_name, 'zh-Hans-CN') ||
    left.id.localeCompare(right.id)
  ));
}

function paginateRows<T>(rows: T[], pagination: PaginationInput) {
  const start = (pagination.page - 1) * pagination.pageSize;
  return rows.slice(start, start + pagination.pageSize);
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null && Number.isFinite(value));
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function buildDetailSummary(rows: DetailRow[]): DetailRow | null {
  if (rows.length === 0) return null;
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalActivations = rows.reduce((sum, row) => sum + row.activations, 0);
  return {
    id: 'summary:total',
    agent_id: '',
    product_id: '',
    channel_id: '',
    record_date: '总计',
    product_name: '',
    channel_name: '',
    agent_name: '',
    creative_type: '',
    promotion_goal: '',
    cost: totalCost,
    cost_dod: average(rows.map((row) => row.cost_dod)),
    activations: totalActivations,
    activations_dod: average(rows.map((row) => row.activations_dod)),
    cpa: totalActivations > 0 ? totalCost / totalActivations : null,
    target_cpa: average(rows.map((row) => row.target_cpa)),
    cpa_dod: average(rows.map((row) => row.cpa_dod)),
    cpa_wow: average(rows.map((row) => row.cpa_wow)),
    cpa_target_deviation: average(rows.map((row) => row.cpa_target_deviation)),
    retention_day1: weightedAverage(rows, 'retention_day1'),
    target_retention_day1: average(rows.map((row) => row.target_retention_day1)),
    retention_day1_dod: average(rows.map((row) => row.retention_day1_dod)),
    retention_day1_wow: average(rows.map((row) => row.retention_day1_wow)),
    retention_day1_target_deviation: average(rows.map((row) => row.retention_day1_target_deviation)),
    retention_day7: weightedAverage(rows, 'retention_day7'),
    target_retention_day7: average(rows.map((row) => row.target_retention_day7)),
    retention_day7_dod: average(rows.map((row) => row.retention_day7_dod)),
    retention_day7_wow: average(rows.map((row) => row.retention_day7_wow)),
    retention_day7_target_deviation: average(rows.map((row) => row.retention_day7_target_deviation)),
    ctr: average(rows.map((row) => row.ctr)),
    cvr: average(rows.map((row) => row.cvr)),
    cpm: average(rows.map((row) => row.cpm)),
    activation_cap: average(rows.map((row) => row.activation_cap)),
    redline_cpa: rows.some((row) => row.redline_cpa),
    redline_retention_day1: rows.some((row) => row.redline_retention_day1),
    redline_retention_day7: rows.some((row) => row.redline_retention_day7),
    redline_count: rows.reduce((sum, row) => sum + row.redline_count, 0),
    has_redline: rows.some((row) => row.has_redline),
    isSummary: true,
    summaryCount: rows.length,
    cpaRedlineCount: rows.filter((row) => row.redline_cpa).length,
    day1RedlineCount: rows.filter((row) => row.redline_retention_day1).length,
    day7RedlineCount: rows.filter((row) => row.redline_retention_day7).length,
  };
}

interface SupabaseRangeQuery<T> {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>;
}

async function fetchSupabaseChunks<T>(buildQuery: () => SupabaseRangeQuery<T>) {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ANALYTICS_ROWS; offset += SUPABASE_FETCH_CHUNK_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + SUPABASE_FETCH_CHUNK_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_FETCH_CHUNK_SIZE) break;
  }
  return rows;
}

function isExpectedAgentDay(targets: Array<Pick<TargetRow, 'agent_id' | 'product_id' | 'channel_id' | 'creative_type' | 'promotion_goal' | 'effective_date' | 'is_running'>>, productId: string, agentId: string, channelId: string, date: string) {
  const latestByScope = new Map<string, Pick<TargetRow, 'effective_date' | 'is_running'>>();
  for (const target of targets) {
    if (
      target.product_id !== productId ||
      target.agent_id !== agentId ||
      target.channel_id !== channelId ||
      target.effective_date > date
    ) {
      continue;
    }
    const scopeKey = `${target.creative_type || '__default__'}:${target.promotion_goal || '__default__'}`;
    const existing = latestByScope.get(scopeKey);
    if (!existing || target.effective_date > existing.effective_date) {
      latestByScope.set(scopeKey, target);
    }
  }
  return Array.from(latestByScope.values()).some((target) => target.is_running);
}

function localRunningAgents(db: LocalDb, focusDate: string, productIds: string[], channelIds: string[], agentIds: string[]) {
  return db.agents
    .filter((agent) => agent.is_active)
    .filter((agent) => productIds.length === 0 || productIds.includes(agent.product_id))
    .filter((agent) => channelIds.length === 0 || channelIds.includes(agent.channel_id))
    .filter((agent) => agentIds.length === 0 || agentIds.includes(agent.id))
    .filter((agent) => isExpectedAgentDay(db.target_changes, agent.product_id, agent.id, agent.channel_id, focusDate));
}

function buildResponse(
  rows: DetailRow[],
  options: {
    dateFrom: string;
    dateTo: string;
    pagination: PaginationInput;
    products: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; name: string }>;
    agents: Array<{ id: string; name: string; product_id: string; product_name: string; channel_id: string; channel_name: string }>;
    creativeTypes: string[];
    promotionGoals: string[];
    runningAgentCount: number;
    detailRowsOverride?: DetailRow[];
  }
) {
  const sortedRows = sortDetailRows(rows);
  const pagedRows = options.detailRowsOverride || paginateRows(sortedRows, options.pagination);
  const summary = summarizeRows(sortedRows);
  const chartDays = Math.min(Math.max(dayjs(options.dateTo).diff(dayjs(options.dateFrom), 'day') + 1, 1), 21);
  const dates = listDates(options.dateTo, chartDays);
  const channelNames = Array.from(new Set(sortedRows.map((row) => row.channel_name))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
  const filledAgents = new Set(sortedRows.filter((row) => row.record_date === options.dateTo).map((row) => row.agent_id)).size;

  return {
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    summaryCards: {
      totalCost: summary.totalCost,
      totalActivations: summary.totalActivations,
      cpa: summary.cpa,
      retentionDay1: summary.retentionDay1,
      retentionDay7: summary.retentionDay7,
    },
    fillProgress: {
      expectedAgents: options.runningAgentCount,
      filledAgents,
      fillRate: options.runningAgentCount > 0 ? Math.round((filledAgents / options.runningAgentCount) * 100) : 0,
    },
    chartSeries: {
      costTrend: buildChart(sortedRows, dates, 'cost', channelNames),
      activationTrend: buildChart(sortedRows, dates, 'activations', channelNames),
      cpaTrend: buildChart(sortedRows, dates, 'cpa', channelNames),
      cpaAlertTrend: buildChart(sortedRows, dates, 'cpaAlerts', channelNames),
      retentionDay1Trend: buildChart(sortedRows, dates, 'retention_day1', channelNames),
      retentionDay1AlertTrend: buildChart(sortedRows, dates, 'day1Alerts', channelNames),
      retentionDay7Trend: buildChart(sortedRows, dates, 'retention_day7', channelNames),
      retentionDay7AlertTrend: buildChart(sortedRows, dates, 'day7Alerts', channelNames),
    },
    detailRows: pagedRows,
    detailSummary: buildDetailSummary(sortedRows),
    pagination: {
      total: sortedRows.length,
      current: options.pagination.page,
      pageSize: options.pagination.pageSize,
    },
    filterOptions: {
      products: options.products,
      channels: options.channels,
      agents: options.agents,
      creativeTypes: options.creativeTypes,
      promotionGoals: options.promotionGoals,
    },
  };
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
    if (session.role === 'agent' && (!session.agentId || !session.channelId)) {
      return NextResponse.json({ success: false, error: 'Agent scope missing' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const dateTo = searchParams.get('dateTo') || defaultBusinessAnchorDate();
    const dateFrom = searchParams.get('dateFrom') || dayjs(dateTo).subtract(20, 'day').format('YYYY-MM-DD');
    const pagination = parsePagination(searchParams);
    let productIds = parseList(searchParams, 'productIds', 'productId');
    let channelIds = parseList(searchParams, 'channelIds', 'channelId');
    let agentIds = parseList(searchParams, 'agentIds', 'agentId');
    const creativeTypes = parseList(searchParams, 'creativeTypes', 'creativeType');
    const promotionGoals = parseList(searchParams, 'promotionGoals', 'promotionGoal');
    const metricFilters = parseMetricFilters(searchParams.get('metricFilters'));

    if (session.role === 'agent') {
      productIds = [session.productId!];
      channelIds = [session.channelId!];
      agentIds = [session.agentId!];
    }

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const alertByRecordId = new Map(db.alert_results.map((alert) => [alert.daily_record_id, alert]));
      const scopedRecordsForOptions = db.daily_records
        .filter((record) => session.role !== 'agent' || (record.agent_id === session.agentId && record.product_id === session.productId && record.channel_id === session.channelId));
      const allCreativeTypes = Array.from(new Set(scopedRecordsForOptions.map((record) => record.creative_type))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
      const allPromotionGoals = Array.from(new Set(scopedRecordsForOptions.map((record) => record.promotion_goal))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
      const optionProducts = db.products
        .filter((product) => product.is_active)
        .filter((product) => session.role !== 'agent' || product.id === session.productId);
      const optionChannels = db.channels
        .filter((channel) => session.role !== 'agent' || channel.id === session.channelId);
      const optionAgents = db.agents
        .filter((agent) => agent.is_active)
        .filter((agent) => db.products.find((product) => product.id === agent.product_id)?.is_active !== false)
        .filter((agent) => session.role !== 'agent' || agent.id === session.agentId);
      const rows = db.daily_records
        .filter((record) => record.record_date >= dateFrom && record.record_date <= dateTo)
        .filter((record) => productIds.length === 0 || productIds.includes(record.product_id))
        .filter((record) => channelIds.length === 0 || channelIds.includes(record.channel_id))
        .filter((record) => agentIds.length === 0 || agentIds.includes(record.agent_id))
        .filter((record) => creativeTypes.length === 0 || creativeTypes.includes(record.creative_type))
        .filter((record) => promotionGoals.length === 0 || promotionGoals.includes(record.promotion_goal))
        .map((record: LocalDailyRecord) => {
          const agent = db.agents.find((item) => item.id === record.agent_id);
          const channel = db.channels.find((item) => item.id === record.channel_id);
          return buildDetailRow(
            record,
            {
              agentName: agent?.name || '',
              productName: db.products.find((product) => product.id === record.product_id)?.name || '',
              channelName: channel?.name || '',
            },
            latestTargetForRecord(db, record.agent_id, record.channel_id, record.record_date, record.product_id, record.creative_type, record.promotion_goal),
            alertByRecordId.get(record.id) || null
          );
        });

      return NextResponse.json({
        success: true,
        data: buildResponse(applyMetricFilters(rows, metricFilters), {
          dateFrom,
          dateTo,
          pagination,
          runningAgentCount: localRunningAgents(db, dateTo, productIds, channelIds, agentIds).length,
          products: optionProducts.map((product) => ({ id: product.id, name: product.name })),
          channels: optionChannels.map((channel) => ({ id: channel.id, name: channel.name })),
          agents: optionAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            product_id: agent.product_id,
            product_name: db.products.find((product) => product.id === agent.product_id)?.name || '',
            channel_id: agent.channel_id,
            channel_name: db.channels.find((channel) => channel.id === agent.channel_id)?.name || '',
          })),
          creativeTypes: allCreativeTypes,
          promotionGoals: allPromotionGoals,
        }),
      });
    }

    const supabase = createServerSupabase();

    const buildRecordsQuery = () => {
      let query = supabase
        .from('daily_records')
        .select('id, agent_id, product_id, channel_id, record_date, creative_type, promotion_goal, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7, agents(name), products(name), channels(name)')
        .gte('record_date', dateFrom)
        .lte('record_date', dateTo)
        .order('record_date', { ascending: false })
        .order('id', { ascending: true });

      if (productIds.length > 0) query = query.in('product_id', productIds);
      if (channelIds.length > 0) query = query.in('channel_id', channelIds);
      if (agentIds.length > 0) query = query.in('agent_id', agentIds);
      if (creativeTypes.length > 0) query = query.in('creative_type', creativeTypes);
      if (promotionGoals.length > 0) query = query.in('promotion_goal', promotionGoals);
      return query;
    };

    const buildAlertsQuery = () => {
      let query = supabase
        .from('alert_results')
        .select('daily_record_id, cost_dod, activations_dod, cpa_dod, cpa_wow, cpa_target_deviation, retention_day1_dod, retention_day1_wow, retention_day1_target_deviation, retention_day7_dod, retention_day7_wow, retention_day7_target_deviation')
        .gte('record_date', dateFrom)
        .lte('record_date', dateTo)
        .order('record_date', { ascending: false })
        .order('daily_record_id', { ascending: true });

      if (productIds.length > 0) query = query.in('product_id', productIds);
      if (channelIds.length > 0) query = query.in('channel_id', channelIds);
      if (agentIds.length > 0) query = query.in('agent_id', agentIds);
      if (creativeTypes.length > 0) query = query.in('creative_type', creativeTypes);
      if (promotionGoals.length > 0) query = query.in('promotion_goal', promotionGoals);
      return query;
    };

    let targetsQuery = supabase
        .from('target_changes')
        .select('agent_id, product_id, channel_id, creative_type, promotion_goal, effective_date, is_running, target_cpa, target_retention_day1, target_retention_day7, activation_cap')
        .lte('effective_date', dateTo)
        .order('effective_date', { ascending: false });
    if (productIds.length > 0) targetsQuery = targetsQuery.in('product_id', productIds);
    if (channelIds.length > 0) targetsQuery = targetsQuery.in('channel_id', channelIds);
    if (agentIds.length > 0) targetsQuery = targetsQuery.in('agent_id', agentIds);
    if (creativeTypes.length > 0) targetsQuery = targetsQuery.in('creative_type', creativeTypes);
    if (promotionGoals.length > 0) targetsQuery = targetsQuery.in('promotion_goal', promotionGoals);

    let agentsQuery = supabase
        .from('agents')
        .select('id, name, product_id, channel_id, is_active, products(name, is_active), channels(name)')
        .order('name');
    if (session.role === 'agent') agentsQuery = agentsQuery.eq('id', session.agentId!);

    let productsQuery = supabase
        .from('products')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');
    if (session.role === 'agent') productsQuery = productsQuery.eq('id', session.productId!);

    let channelsQuery = supabase
        .from('channels')
        .select('id, name')
        .order('name');
    if (session.role === 'agent') channelsQuery = channelsQuery.eq('id', session.channelId!);

    const [recordsData, alertsData, targetsRes, agentsRes, productsRes, channelsRes] = await Promise.all([
      fetchSupabaseChunks<Record<string, unknown>>(buildRecordsQuery),
      fetchSupabaseChunks<AlertRow>(buildAlertsQuery),
      targetsQuery,
      agentsQuery,
      productsQuery,
      channelsQuery,
    ]);

    if (targetsRes.error) throw targetsRes.error;
    if (agentsRes.error) throw agentsRes.error;
    if (productsRes.error) throw productsRes.error;
    if (channelsRes.error) throw channelsRes.error;

    const targets = (targetsRes.data || []) as TargetRow[];
    const alertByRecordId = new Map(alertsData.map((alert) => [alert.daily_record_id, alert]));
    const rows = recordsData.map((row) => {
      const source = {
        id: String(row.id),
        agent_id: String(row.agent_id),
        product_id: String(row.product_id),
        channel_id: String(row.channel_id),
        record_date: String(row.record_date),
        creative_type: String(row.creative_type || ''),
        promotion_goal: String(row.promotion_goal || ''),
        cost: row.cost as string | number | null,
        activations: row.activations as string | number | null,
        cpa: row.cpa as string | number | null,
        ctr: row.ctr as string | number | null,
        cvr: row.cvr as string | number | null,
        cpm: row.cpm as string | number | null,
        retention_day1: row.retention_day1 as string | number | null,
        retention_day7: row.retention_day7 as string | number | null,
      };
      return buildDetailRow(
        source,
        {
          agentName: relationName(row.agents),
          productName: relationName(row.products),
          channelName: relationName(row.channels),
        },
        latestTarget(targets, source.product_id, source.agent_id, source.channel_id, source.creative_type, source.promotion_goal, source.record_date),
        alertByRecordId.get(source.id) || null
      );
    });

    const agents = ((agentsRes.data || []) as Array<Record<string, unknown>>).map((agent) => ({
      id: String(agent.id),
      name: String(agent.name),
      product_id: String(agent.product_id),
      product_name: relationName(agent.products),
      product_is_active: relationIsActive(agent.products),
      channel_id: String(agent.channel_id),
      channel_name: relationName(agent.channels),
      is_active: Boolean(agent.is_active),
    }));
    const activeProductAgents = agents.filter((agent) => agent.is_active && agent.product_is_active);
    const runningAgentCount = activeProductAgents
      .filter((agent) => agent.is_active)
      .filter((agent) => productIds.length === 0 || productIds.includes(agent.product_id))
      .filter((agent) => channelIds.length === 0 || channelIds.includes(agent.channel_id))
      .filter((agent) => agentIds.length === 0 || agentIds.includes(agent.id))
      .filter((agent) => isExpectedAgentDay(targets, agent.product_id, agent.id, agent.channel_id, dateTo))
      .length;

    return NextResponse.json({
      success: true,
      data: buildResponse(applyMetricFilters(rows, metricFilters), {
        dateFrom,
        dateTo,
        pagination,
        runningAgentCount,
        products: ((productsRes.data || []) as Array<Record<string, unknown>>).map((product) => ({
          id: String(product.id),
          name: String(product.name),
        })),
        channels: ((channelsRes.data || []) as Array<Record<string, unknown>>).map((channel) => ({
          id: String(channel.id),
          name: String(channel.name),
        })),
        agents: activeProductAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          product_id: agent.product_id,
          product_name: agent.product_name,
          channel_id: agent.channel_id,
          channel_name: agent.channel_name,
        })),
        creativeTypes: Array.from(new Set(rows.map((row) => row.creative_type))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
        promotionGoals: Array.from(new Set(rows.map((row) => row.promotion_goal))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      }),
    });
  } catch (error) {
    console.error('GET /api/analytics error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
