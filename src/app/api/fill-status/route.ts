import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import {
  beijingDeadlineIso,
  beijingDeadlineLabel,
  isLateFill,
  listDates,
} from '@/lib/admin/metrics';
import { readLocalDb } from '@/lib/local-db/store';
import { DEFAULT_PROMOTION_GOAL, normalizeAuthorizedScopes, normalizeCreativeTypes } from '@/lib/admin/creativeTypes';

type FillStatus = 'missing' | 'pending' | 'late' | 'on_time' | 'not_required';

interface FillAgent {
  id: string;
  name: string;
  product_id: string;
  product_name: string;
  channel_id: string;
  channel_name: string;
  creative_types: string[];
  is_active: boolean;
}

interface FillRecord {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  promotion_goal: string;
  record_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TargetRow {
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type?: string;
  promotion_goal?: string;
  effective_date: string;
  is_running: boolean;
}

interface DetailRow {
  id: string;
  date: string;
  agent_id: string;
  agent_name: string;
  product_id: string;
  product_name: string;
  channel_id: string;
  channel_name: string;
  creative_type: string;
  promotion_goal: string;
  expected: boolean;
  filled: boolean;
  status: FillStatus;
  is_late: boolean;
  deadline_at: string;
  deadline_label: string;
  first_filled_at: string | null;
  last_modified_at: string | null;
  record_count: number;
  filled_by: string[];
}

const STATUS_ORDER: Record<FillStatus, number> = {
  missing: 0,
  pending: 1,
  late: 2,
  on_time: 3,
  not_required: 4,
};

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { name?: string } | null;
  return relation?.name || '';
}

function latestTargetForCreative(
  targets: TargetRow[],
  productId: string,
  agentId: string,
  channelId: string,
  creativeType: string,
  promotionGoal: string,
  date: string
) {
  let latest: TargetRow | null = null;
  for (const target of targets) {
    if (
      target.product_id !== productId ||
      target.agent_id !== agentId ||
      target.channel_id !== channelId ||
      target.creative_type !== creativeType ||
      target.promotion_goal !== promotionGoal ||
      target.effective_date > date
    ) {
      continue;
    }
    if (!latest || target.effective_date > latest.effective_date) {
      latest = target;
    }
  }
  return latest;
}

function isExpectedCreativeDay(targets: TargetRow[], productId: string, agentId: string, channelId: string, creativeType: string, promotionGoal: string, date: string) {
  return latestTargetForCreative(targets, productId, agentId, channelId, creativeType, promotionGoal, date)?.is_running === true;
}

function scopesForAgent(agent: FillAgent, targets: TargetRow[], records: FillRecord[]) {
  return normalizeAuthorizedScopes([
    ...normalizeCreativeTypes(agent.creative_types).map((creativeType) => ({
      creative_type: creativeType,
      promotion_goal: DEFAULT_PROMOTION_GOAL,
    })),
    ...targets
      .filter((target) => target.product_id === agent.product_id && target.agent_id === agent.id && target.channel_id === agent.channel_id)
      .map((target) => ({ creative_type: target.creative_type || '', promotion_goal: target.promotion_goal || DEFAULT_PROMOTION_GOAL })),
    ...records
      .filter((record) => record.product_id === agent.product_id && record.agent_id === agent.id && record.channel_id === agent.channel_id)
      .map((record) => ({ creative_type: record.creative_type || '', promotion_goal: record.promotion_goal || DEFAULT_PROMOTION_GOAL })),
  ]);
}

function minIso(values: string[]) {
  return values.length > 0 ? [...values].sort()[0] : null;
}

function maxIso(values: string[]) {
  return values.length > 0 ? [...values].sort().reverse()[0] : null;
}

function parseList(searchParams: URLSearchParams, key: string, legacyKey?: string) {
  const raw = [
    ...searchParams.getAll(key),
    searchParams.get(key) || '',
    legacyKey ? searchParams.get(legacyKey) || '' : '',
  ];
  return Array.from(new Set(raw.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)));
}

function clampDateRange(searchParams: URLSearchParams) {
  const legacyFocusDate = searchParams.get('date');
  const legacyDays = Number(searchParams.get('days') || 7);
  const dateTo = searchParams.get('dateTo') || legacyFocusDate || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const requestedFrom = searchParams.get('dateFrom') || dayjs(dateTo).subtract(Math.min(Math.max(legacyDays, 1), 21) - 1, 'day').format('YYYY-MM-DD');
  const days = Math.min(Math.max(dayjs(dateTo).diff(dayjs(requestedFrom), 'day') + 1, 1), 21);
  const dateFrom = dayjs(dateTo).subtract(days - 1, 'day').format('YYYY-MM-DD');
  return { dateFrom, dateTo, dates: listDates(dateTo, days) };
}

function buildStatusForDate(agent: FillAgent, creativeType: string, promotionGoal: string, date: string, records: FillRecord[], isExpected: boolean, now: Date): DetailRow {
  const dayRecords = records.filter((record) => (
    record.agent_id === agent.id &&
    record.product_id === agent.product_id &&
    record.channel_id === agent.channel_id &&
    record.creative_type === creativeType &&
    record.promotion_goal === promotionGoal &&
    record.record_date === date
  ));
  const firstFilledAt = minIso(dayRecords.map((record) => record.created_at));
  const lastModifiedAt = maxIso(dayRecords.map((record) => record.updated_at));
  const filled = dayRecords.length > 0;
  const late = isExpected && isLateFill(date, firstFilledAt, now);
  const deadlinePassed = now.getTime() > new Date(beijingDeadlineIso(date)).getTime();
  const status: FillStatus = !isExpected
    ? 'not_required'
    : filled
      ? late ? 'late' : 'on_time'
      : deadlinePassed ? 'missing' : 'pending';

  return {
    id: `${date}:${agent.id}:${creativeType}:${promotionGoal}`,
    date,
    agent_id: agent.id,
    agent_name: agent.name,
    product_id: agent.product_id,
    product_name: agent.product_name,
    channel_id: agent.channel_id,
    channel_name: agent.channel_name,
    creative_type: creativeType,
    promotion_goal: promotionGoal,
    expected: isExpected,
    filled,
    status,
    is_late: status === 'late' || status === 'missing',
    deadline_at: beijingDeadlineIso(date),
    deadline_label: beijingDeadlineLabel(date),
    first_filled_at: firstFilledAt,
    last_modified_at: lastModifiedAt,
    record_count: dayRecords.length,
    filled_by: Array.from(new Set(dayRecords.map((record) => record.created_by).filter(Boolean))) as string[],
  };
}

function applyFilters(
  rows: DetailRow[],
  filters: {
    channelIds: string[];
    productIds: string[];
    agentIds: string[];
    statuses: FillStatus[];
    promotionGoals: string[];
    filledBy: string;
  }
) {
  const filledBy = filters.filledBy.trim().toLowerCase();
  return rows
    .filter((row) => filters.channelIds.length === 0 || filters.channelIds.includes(row.channel_id))
    .filter((row) => filters.productIds.length === 0 || filters.productIds.includes(row.product_id))
    .filter((row) => filters.agentIds.length === 0 || filters.agentIds.includes(row.agent_id))
    .filter((row) => filters.promotionGoals.length === 0 || filters.promotionGoals.includes(row.promotion_goal))
    .filter((row) => filters.statuses.length === 0 || filters.statuses.includes(row.status))
    .filter((row) => !filledBy || row.filled_by.some((name) => name.toLowerCase().includes(filledBy)));
}

function sortRows(rows: DetailRow[]) {
  return [...rows].sort((left, right) => (
    right.date.localeCompare(left.date) ||
    STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
    left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
    left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
    left.creative_type.localeCompare(right.creative_type, 'zh-Hans-CN') ||
    left.promotion_goal.localeCompare(right.promotion_goal, 'zh-Hans-CN') ||
    left.agent_name.localeCompare(right.agent_name, 'zh-Hans-CN')
  ));
}

function buildResponse(
  agents: FillAgent[],
  records: FillRecord[],
  targets: TargetRow[],
  dates: string[],
  filters: {
    productIds: string[];
    channelIds: string[];
    agentIds: string[];
    promotionGoals: string[];
    statuses: FillStatus[];
    filledBy: string;
  }
) {
  const now = new Date();
  const expectedRows = agents
    .filter((agent) => agent.is_active)
    .flatMap((agent) => scopesForAgent(agent, targets, records)
      .flatMap((scope) => dates.map((date) => buildStatusForDate(
        agent,
        scope.creative_type,
        scope.promotion_goal,
        date,
        records,
        isExpectedCreativeDay(targets, agent.product_id, agent.id, agent.channel_id, scope.creative_type, scope.promotion_goal, date),
        now
      ))))
    .filter((row) => row.expected);
  const filteredRows = sortRows(applyFilters(expectedRows, filters));

  const summaryCards = {
    expectedAgentDays: filteredRows.length,
    filledAgentDays: filteredRows.filter((row) => row.filled).length,
    onTimeFilled: filteredRows.filter((row) => row.status === 'on_time').length,
    lateFilled: filteredRows.filter((row) => row.status === 'late').length,
    overdueMissing: filteredRows.filter((row) => row.status === 'missing').length,
    completionRate: filteredRows.length > 0
      ? Math.round((filteredRows.filter((row) => row.filled).length / filteredRows.length) * 100)
      : 0,
  };

  const grouped = new Map<string, DetailRow[]>();
  for (const row of filteredRows) {
    const key = `${row.agent_id}:${row.creative_type}:${row.promotion_goal}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const lateRankSeries = Array.from(grouped.values())
    .map((rows) => {
      const first = rows[0];
      return {
        agent_id: first.agent_id,
        agent_name: first.agent_name,
        channel_id: first.channel_id,
        channel_name: first.channel_name,
        creative_type: first.creative_type,
        promotion_goal: first.promotion_goal,
        agent_label: `${first.product_name} / ${first.channel_name} / ${first.creative_type} / ${first.promotion_goal} / ${first.agent_name}`,
        missing_count: rows.filter((row) => row.status === 'missing').length,
        late_filled_count: rows.filter((row) => row.status === 'late').length,
        total_late_count: rows.filter((row) => row.status === 'missing' || row.status === 'late').length,
      };
    })
    .filter((row) => row.total_late_count > 0)
    .sort((left, right) => right.total_late_count - left.total_late_count)
    .slice(0, 12)
    .flatMap((row) => [
      { ...row, type: '逾期未填', value: row.missing_count },
      { ...row, type: '逾期已填', value: row.late_filled_count },
    ])
    .filter((row) => row.value > 0);

  return {
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    summaryCards,
    lateRankSeries,
    detailRows: filteredRows,
    filterOptions: {
      channels: Array.from(new Map(agents.map((agent) => [agent.channel_id, { id: agent.channel_id, name: agent.channel_name }])).values())
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')),
      products: Array.from(new Map(agents.map((agent) => [agent.product_id, { id: agent.product_id, name: agent.product_name }])).values())
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')),
      agents: agents
        .filter((agent) => agent.is_active)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          product_id: agent.product_id,
          product_name: agent.product_name,
          channel_id: agent.channel_id,
          channel_name: agent.channel_name,
        }))
        .sort((left, right) => (
          left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
          left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
          left.name.localeCompare(right.name, 'zh-Hans-CN')
        )),
      filledBy: Array.from(new Set(expectedRows.flatMap((row) => row.filled_by))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      creativeTypes: Array.from(new Set(expectedRows.map((row) => row.creative_type))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      promotionGoals: Array.from(new Set(expectedRows.map((row) => row.promotion_goal))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      statuses: [
        { value: 'missing', label: '逾期未填' },
        { value: 'pending', label: '待填' },
        { value: 'late', label: '逾期已填' },
        { value: 'on_time', label: '准时已填' },
      ],
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
    const { dateTo, dates } = clampDateRange(searchParams);
    const filters = {
      productIds: parseList(searchParams, 'productIds', 'productId'),
      channelIds: parseList(searchParams, 'channelIds', 'channelId'),
      agentIds: parseList(searchParams, 'agentIds', 'agentId'),
      promotionGoals: parseList(searchParams, 'promotionGoals', 'promotionGoal'),
      statuses: parseList(searchParams, 'statuses').filter((status): status is FillStatus => ['missing', 'pending', 'late', 'on_time'].includes(status)),
      filledBy: searchParams.get('filledBy') || '',
    };

    if (session.role === 'agent') {
      filters.productIds = [session.productId!];
      filters.channelIds = [session.channelId!];
      filters.agentIds = [session.agentId!];
    }

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const agents = db.agents
        .filter((agent) => agent.is_active)
        .filter((agent) => session.role !== 'agent' || (agent.id === session.agentId && agent.product_id === session.productId))
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          product_id: agent.product_id,
          product_name: db.products.find((product) => product.id === agent.product_id)?.name || '',
          channel_id: agent.channel_id,
          channel_name: db.channels.find((channel) => channel.id === agent.channel_id)?.name || '',
          creative_types: normalizeCreativeTypes(agent.creative_types),
          is_active: agent.is_active,
        }));
      const records = db.daily_records
        .filter((record) => dates.includes(record.record_date))
        .filter((record) => session.role !== 'agent' || (record.agent_id === session.agentId && record.product_id === session.productId))
        .map((record) => ({
          id: record.id,
          agent_id: record.agent_id,
          product_id: record.product_id,
          channel_id: record.channel_id,
          creative_type: record.creative_type,
          promotion_goal: record.promotion_goal,
          record_date: record.record_date,
          created_by: record.created_by,
          created_at: record.created_at,
          updated_at: record.updated_at,
        }));

      return NextResponse.json({
        success: true,
        data: buildResponse(
          agents,
          records,
          db.target_changes,
          dates,
          filters
        ),
      });
    }

    const supabase = createServerSupabase();
    let agentsQuery = supabase
        .from('agents')
        .select('id, name, product_id, channel_id, creative_types, is_active, products(name), channels(name)')
        .eq('is_active', true)
        .order('name');
    if (session.role === 'agent') agentsQuery = agentsQuery.eq('id', session.agentId!);

    let recordsQuery = supabase
        .from('daily_records')
        .select('id, agent_id, product_id, channel_id, creative_type, promotion_goal, record_date, created_by, created_at, updated_at')
        .gte('record_date', dates[0])
        .lte('record_date', dateTo);
    if (session.role === 'agent') {
      recordsQuery = recordsQuery.eq('agent_id', session.agentId!).eq('product_id', session.productId!).eq('channel_id', session.channelId!);
    }

    let targetsQuery = supabase
        .from('target_changes')
        .select('agent_id, product_id, channel_id, creative_type, promotion_goal, effective_date, is_running')
        .lte('effective_date', dateTo)
        .order('effective_date', { ascending: false });
    if (session.role === 'agent') {
      targetsQuery = targetsQuery.eq('agent_id', session.agentId!).eq('product_id', session.productId!).eq('channel_id', session.channelId!);
    }

    const [agentsRes, recordsRes, targetsRes] = await Promise.all([
      agentsQuery,
      recordsQuery,
      targetsQuery,
    ]);

    if (agentsRes.error) throw agentsRes.error;
    if (recordsRes.error) throw recordsRes.error;
    if (targetsRes.error) throw targetsRes.error;

    const agents = ((agentsRes.data || []) as Array<Record<string, unknown>>).map((agent) => ({
      id: String(agent.id),
      name: String(agent.name),
      product_id: String(agent.product_id),
      product_name: relationName(agent.products),
      channel_id: String(agent.channel_id),
      channel_name: relationName(agent.channels),
      creative_types: normalizeCreativeTypes(agent.creative_types),
      is_active: Boolean(agent.is_active),
    }));
    const records = ((recordsRes.data || []) as Array<Record<string, unknown>>).map((record) => ({
      id: String(record.id),
      agent_id: String(record.agent_id),
      product_id: String(record.product_id),
      channel_id: String(record.channel_id),
      creative_type: String(record.creative_type || ''),
      promotion_goal: String(record.promotion_goal || DEFAULT_PROMOTION_GOAL),
      record_date: String(record.record_date),
      created_by: record.created_by == null ? null : String(record.created_by),
      created_at: String(record.created_at),
      updated_at: String(record.updated_at),
    }));
    const targets = (targetsRes.data || []) as TargetRow[];

    return NextResponse.json({
      success: true,
      data: buildResponse(
        agents,
        records,
        targets,
        dates,
        filters
      ),
    });
  } catch (error) {
    console.error('GET /api/fill-status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch fill status' }, { status: 500 });
  }
}
