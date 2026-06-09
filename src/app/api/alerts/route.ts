import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { decorateAlert, readLocalDb } from '@/lib/local-db/store';
import { buildMetricDetails } from '@/lib/admin/metrics';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

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

      return NextResponse.json({
        success: true,
        data: rows.slice(pagination.from, pagination.to + 1).map((alert) => decorateAlert(db, alert)),
        pagination: {
          total: rows.length,
          current: pagination.page,
          pageSize: pagination.pageSize,
        },
      });
    }

    const supabase = createServerSupabase();
    let query = supabase
      .from('alert_results')
      .select('*, agents!inner(name, feishu_webhook), products!inner(name), channels!inner(name), daily_records!inner(cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7)', { count: 'exact' })
      .order('record_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(pagination.from, pagination.to);

    if (dateFrom) query = query.gte('record_date', dateFrom);
    if (dateTo) query = query.lte('record_date', dateTo);
    if (agentId) query = query.eq('agent_id', agentId);
    if (productId) query = query.eq('product_id', productId);
    if (channelId) query = query.eq('channel_id', channelId);
    if (promotionGoal) query = query.eq('promotion_goal', promotionGoal);
    if (status === 'processed') query = query.in('status', ['acknowledged', 'resolved']);
    if (status && status !== 'all' && status !== 'processed') query = query.eq('status', status);
    if (hasAlert === 'true') query = query.eq('has_alert', true);

    const { data, error, count } = await query;
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

    const rows = (data || []).map((row: Record<string, unknown>) => {
      const agent = row.agents as { name?: string; feishu_webhook?: string | null } | null;
      const target = latestTarget(targetRows, String(row.product_id), String(row.agent_id), String(row.channel_id), String(row.creative_type), String(row.promotion_goal || ''), String(row.record_date));
      return {
        ...row,
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
          target
        ),
        agents: undefined,
        products: undefined,
        channels: undefined,
        daily_records: undefined,
      };
    });

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        total: count || 0,
        current: pagination.page,
        pageSize: pagination.pageSize,
      },
    });
  } catch (error) {
    console.error('GET /api/alerts error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch alerts' }, { status: 500 });
  }
}
