import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { csvResponse } from '@/lib/admin/csv';
import { decorateAlert, readLocalDb } from '@/lib/local-db/store';
import { buildMetricDetails, toNumberOrNull } from '@/lib/admin/metrics';
import {
  buildMetricIssueHitMap,
  buildThresholdLookup,
  readOptionalAlertThresholdRows,
  type AlertThresholdSettingLike,
} from '@/lib/admin/alertThresholds';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const SUPABASE_FETCH_CHUNK_SIZE = 1000;
const MAX_ALERT_EXPORT_ROWS = 100000;

interface TargetRow {
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  effective_date: string;
  target_cpa: number | string | null;
  target_retention_day1: number | string | null;
  target_retention_day7: number | string | null;
  activation_cap?: number | string | null;
}

interface AlertMetricDetail {
  key: string;
  name: string;
  unit: 'number' | 'percent';
  actualValue: number | null;
  targetValue: number | null;
  dod: number | null;
  wow: number | null;
  targetDeviation: number | null;
  dodHit?: boolean;
  wowHit?: boolean;
  targetDeviationHit?: boolean;
  hit: boolean;
}

interface DecoratedAlertRow {
  id: string;
  record_date: string;
  product_name?: string;
  channel_name?: string;
  creative_type?: string;
  promotion_goal?: string;
  agent_name?: string;
  feishu_webhook?: string | null;
  metricDetails?: AlertMetricDetail[];
}

interface SupabaseRangeQuery<T> {
  range: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>;
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

function matchesStatusFilter(alertStatus: string | null | undefined, filter: string | null) {
  if (!filter || filter === 'all') return true;
  if (filter === 'processed') return alertStatus === 'acknowledged' || alertStatus === 'resolved';
  return alertStatus === filter;
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

function parsePagination(searchParams: URLSearchParams) {
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const pageSize = Math.min(parsePositiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return {
    page,
    pageSize,
    from: (page - 1) * pageSize,
    to: page * pageSize - 1,
  };
}

async function fetchSupabaseChunks<T>(buildQuery: () => SupabaseRangeQuery<T>) {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ALERT_EXPORT_ROWS; offset += SUPABASE_FETCH_CHUNK_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + SUPABASE_FETCH_CHUNK_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_FETCH_CHUNK_SIZE) break;
  }
  return rows;
}

function baselineFromDeviation(actual: number | null, deviation: number | null) {
  if (actual == null || deviation == null || deviation === -100) return null;
  return actual / (1 + deviation / 100);
}

function alertDetailRows(rows: DecoratedAlertRow[]) {
  return rows.flatMap((row) => (
    (row.metricDetails || []).flatMap((detail) => {
      const candidates = [
        {
          type: '日环比偏离',
          value: detail.dod,
          baseline: baselineFromDeviation(detail.actualValue, detail.dod),
          hit: Boolean(detail.dodHit),
        },
        {
          type: '周同比偏离',
          value: detail.wow,
          baseline: baselineFromDeviation(detail.actualValue, detail.wow),
          hit: Boolean(detail.wowHit),
        },
        {
          type: '考核值偏离',
          value: detail.targetDeviation,
          baseline: detail.targetValue,
          hit: Boolean(detail.targetDeviationHit),
        },
      ];

      return candidates
        .filter((candidate) => candidate.hit)
        .map((candidate) => ({
          date: row.record_date,
          product_name: row.product_name || '',
          channel_name: row.channel_name || '',
          creative_type: row.creative_type || '',
          promotion_goal: row.promotion_goal || '',
          agent_name: row.agent_name || '',
          feishu_webhook: row.feishu_webhook || '',
          alert_metric: detail.name,
          alert_type: candidate.type,
          actual_value: detail.actualValue,
          baseline_value: candidate.baseline,
          deviation_pct: candidate.value,
        }));
    })
  )).sort((left, right) => (
    right.date.localeCompare(left.date) ||
    left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
    left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
    left.agent_name.localeCompare(right.agent_name, 'zh-Hans-CN') ||
    left.alert_metric.localeCompare(right.alert_metric, 'zh-Hans-CN') ||
    left.alert_type.localeCompare(right.alert_type, 'zh-Hans-CN')
  ));
}

function csvValue(value: string | number | null | undefined) {
  return value == null ? '' : String(value);
}

function alertsCsvResponse(rows: DecoratedAlertRow[], dateFrom: string | null, dateTo: string | null) {
  const filenameFrom = dateFrom || 'all';
  const filenameTo = dateTo || 'latest';
  return csvResponse(
    `yokoagent-alert-detail-${filenameFrom}_${filenameTo}.csv`,
    ['日期', '产品', '渠道', '体裁', '投放目标', '代理商', '飞书webhook', '告警指标', '告警类型', 'T-1填列值', '基准值', '偏离百分比(%)'],
    alertDetailRows(rows).map((row) => [
      row.date,
      row.product_name,
      row.channel_name,
      row.creative_type,
      row.promotion_goal,
      row.agent_name,
      row.feishu_webhook,
      row.alert_metric,
      row.alert_type,
      csvValue(row.actual_value),
      csvValue(row.baseline_value),
      csvValue(row.deviation_pct),
    ])
  );
}

// GET /api/alerts - List computed site alerts
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
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const agentId = session.role === 'agent' ? session.agentId : searchParams.get('agentId');
    const productId = session.role === 'agent' ? session.productId : searchParams.get('productId');
    const channelId = session.role === 'agent' ? session.channelId : searchParams.get('channelId');
    const status = searchParams.get('status');
    const hasAlert = searchParams.get('hasAlert');
    const promotionGoal = searchParams.get('promotionGoal');
    const wantsCsv = searchParams.get('format') === 'csv';
    const pagination = parsePagination(searchParams);

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const rows = db.alert_results
        .filter((alert) => !dateFrom || alert.record_date >= dateFrom)
        .filter((alert) => !dateTo || alert.record_date <= dateTo)
        .filter((alert) => !agentId || alert.agent_id === agentId)
        .filter((alert) => !productId || alert.product_id === productId)
        .filter((alert) => !channelId || alert.channel_id === channelId)
        .filter((alert) => !promotionGoal || alert.promotion_goal === promotionGoal)
        .filter((alert) => matchesStatusFilter(alert.status, status))
        .filter((alert) => hasAlert !== 'true' || alert.has_alert)
        .sort((left, right) => (
          right.record_date.localeCompare(left.record_date) ||
          right.updated_at.localeCompare(left.updated_at)
        ));
      const decoratedRows = rows
        .map((alert) => decorateAlert(db, alert))
        .filter((alert) => hasAlert !== 'true' || alert.metricDetails.some((detail) => detail.hit));

      if (wantsCsv) {
        return alertsCsvResponse(decoratedRows, dateFrom, dateTo);
      }

      return NextResponse.json({
        success: true,
        data: decoratedRows.slice(pagination.from, pagination.to + 1),
        pagination: {
          total: decoratedRows.length,
          current: pagination.page,
          pageSize: pagination.pageSize,
        },
      });
    }

    const supabase = createServerSupabase();
    const buildAlertsQuery = () => {
      let query = supabase
        .from('alert_results')
        .select('*, agents!inner(name, feishu_webhook), products!inner(name), channels!inner(name), daily_records!inner(cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7)', { count: 'exact' })
        .order('record_date', { ascending: false })
        .order('updated_at', { ascending: false });

      if (dateFrom) query = query.gte('record_date', dateFrom);
      if (dateTo) query = query.lte('record_date', dateTo);
      if (agentId) query = query.eq('agent_id', agentId);
      if (productId) query = query.eq('product_id', productId);
      if (channelId) query = query.eq('channel_id', channelId);
      if (promotionGoal) query = query.eq('promotion_goal', promotionGoal);
      if (status === 'processed') query = query.in('status', ['acknowledged', 'resolved']);
      if (status && status !== 'all' && status !== 'processed') query = query.eq('status', status);
      if (hasAlert === 'true') query = query.eq('has_alert', true);
      return query;
    };

    const { data, error, count } = wantsCsv
      ? { data: await fetchSupabaseChunks<Record<string, unknown>>(buildAlertsQuery), error: null, count: null }
      : await buildAlertsQuery().range(pagination.from, pagination.to);
    if (error) throw error;

    const latestDate = dateTo || (data || []).reduce((maxDate, row: Record<string, unknown>) => (
      String(row.record_date) > maxDate ? String(row.record_date) : maxDate
    ), '1900-01-01');
    let targetsQuery = supabase
      .from('target_changes')
      .select('agent_id, product_id, channel_id, creative_type, promotion_goal, effective_date, target_cpa, target_retention_day1, target_retention_day7, activation_cap')
      .lte('effective_date', latestDate)
      .order('effective_date', { ascending: false });
    if (agentId) targetsQuery = targetsQuery.eq('agent_id', agentId);
    if (productId) targetsQuery = targetsQuery.eq('product_id', productId);
    if (channelId) targetsQuery = targetsQuery.eq('channel_id', channelId);
    if (promotionGoal) targetsQuery = targetsQuery.eq('promotion_goal', promotionGoal);
    const { data: targets, error: targetsError } = await targetsQuery;

    if (targetsError) throw targetsError;
    const targetRows = (targets || []) as TargetRow[];
    let thresholdsQuery = supabase
      .from('alert_threshold_settings')
      .select('product_id, channel_id, creative_type, metric_key, upper_threshold, lower_threshold');
    if (productId) thresholdsQuery = thresholdsQuery.eq('product_id', productId);
    if (channelId) thresholdsQuery = thresholdsQuery.eq('channel_id', channelId);
    const thresholdLookup = buildThresholdLookup(
      await readOptionalAlertThresholdRows<AlertThresholdSettingLike>(thresholdsQuery)
    );

    const rows: Array<DecoratedAlertRow & Record<string, unknown>> = (data || []).map((row: Record<string, unknown>) => {
      const agent = row.agents as { name?: string; feishu_webhook?: string | null } | null;
      const target = latestTarget(targetRows, String(row.product_id), String(row.agent_id), String(row.channel_id), String(row.creative_type), String(row.promotion_goal || ''), String(row.record_date));
      const issueHits = buildMetricIssueHitMap(
        thresholdLookup,
        String(row.product_id),
        String(row.channel_id),
        String(row.creative_type),
        {
          cost_dod: toNumberOrNull(row.cost_dod),
          cost_wow: toNumberOrNull(row.cost_wow),
          activations_dod: toNumberOrNull(row.activations_dod),
          activations_wow: toNumberOrNull(row.activations_wow),
          cpa_target_deviation: toNumberOrNull(row.cpa_target_deviation),
          cpa_dod: toNumberOrNull(row.cpa_dod),
          cpa_wow: toNumberOrNull(row.cpa_wow),
          retention_day1_dod: toNumberOrNull(row.retention_day1_dod),
          retention_day1_wow: toNumberOrNull(row.retention_day1_wow),
          retention_day1_target_deviation: toNumberOrNull(row.retention_day1_target_deviation),
          retention_day7_dod: toNumberOrNull(row.retention_day7_dod),
          retention_day7_wow: toNumberOrNull(row.retention_day7_wow),
          retention_day7_target_deviation: toNumberOrNull(row.retention_day7_target_deviation),
        }
      );
      return {
        ...row,
        id: String(row.id),
        record_date: String(row.record_date),
        creative_type: String(row.creative_type || ''),
        promotion_goal: String(row.promotion_goal || ''),
        agent_name: agent?.name,
        product_name: (row.products as { name?: string } | null)?.name,
        feishu_webhook: agent?.feishu_webhook || '',
        channel_name: (row.channels as { name?: string } | null)?.name,
        record: row.daily_records,
        target_cpa: target?.target_cpa ?? null,
        target_retention_day1: target?.target_retention_day1 ?? null,
        target_retention_day7: target?.target_retention_day7 ?? null,
        activation_cap: target?.activation_cap ?? null,
        metricDetails: buildMetricDetails(
          row,
          row.daily_records as Record<string, unknown> | null,
          target,
          issueHits
        ),
        agents: undefined,
        products: undefined,
        channels: undefined,
        daily_records: undefined,
      };
    });
    const visibleRows = hasAlert === 'true'
      ? rows.filter((row) => row.metricDetails?.some((detail) => detail.hit))
      : rows;

    if (wantsCsv) {
      return alertsCsvResponse(visibleRows, dateFrom, dateTo);
    }

    return NextResponse.json({
      success: true,
      data: visibleRows,
      pagination: {
        total: hasAlert === 'true' ? visibleRows.length : count || 0,
        current: pagination.page,
        pageSize: pagination.pageSize,
      },
    });
  } catch (error) {
    console.error('GET /api/alerts error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch alerts' }, { status: 500 });
  }
}
