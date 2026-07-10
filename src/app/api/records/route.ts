import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { DEFAULT_PROMOTION_GOAL, normalizeDictionaryName } from '@/lib/admin/creativeTypes';
import { isSupabaseScopeAuthorized } from '@/lib/admin/scopes';
import {
  decorateRecord,
  computedCpa,
  isLocalScopeAuthorized,
  mutateLocalDb,
  newId,
  nowIso,
  readLocalDb,
  recalculateLocalAlertsForRecordIds,
} from '@/lib/local-db/store';

function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

async function latestTargetForRecord(
  supabase: ReturnType<typeof createServerSupabase>,
  agentId: string,
  channelId: string,
  recordDate: string,
  productId: string,
  creativeType: string,
  promotionGoal: string
) {
  const { data } = await supabase
    .from('target_changes')
    .select('target_cpa, target_retention_day1, target_retention_day7, activation_cap, is_running')
    .eq('agent_id', agentId)
    .eq('product_id', productId)
    .eq('channel_id', channelId)
    .eq('creative_type', creativeType)
    .eq('promotion_goal', promotionGoal)
    .lte('effective_date', recordDate)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as {
    target_cpa?: number | string | null;
    target_retention_day1?: number | string | null;
    target_retention_day7?: number | string | null;
    activation_cap?: number | string | null;
    is_running?: boolean;
  } | null;
}

// GET /api/records - List T-1 records with role isolation
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const productId = searchParams.get('productId');
    const channelId = searchParams.get('channelId');
    const agentId = searchParams.get('agentId');
    const creativeType = searchParams.get('creativeType');
    const promotionGoal = searchParams.get('promotionGoal');

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      let records = [...db.daily_records];

      if (session.role === 'agent') {
        records = records.filter((record) => record.agent_id === session.agentId && record.product_id === session.productId);
      } else {
        if (agentId) records = records.filter((record) => record.agent_id === agentId);
        if (productId) records = records.filter((record) => record.product_id === productId);
        if (channelId) records = records.filter((record) => record.channel_id === channelId);
      }

      if (dateFrom) records = records.filter((record) => record.record_date >= dateFrom);
      if (dateTo) records = records.filter((record) => record.record_date <= dateTo);
      if (creativeType) records = records.filter((record) => record.creative_type.includes(creativeType));
      if (promotionGoal) records = records.filter((record) => record.promotion_goal === promotionGoal);

      records.sort((left, right) => (
        right.record_date.localeCompare(left.record_date) ||
        right.created_at.localeCompare(left.created_at)
      ));

      return NextResponse.json({
        success: true,
        data: records.map((record) => decorateRecord(db, record)),
      });
    }

    const supabase = createServerSupabase();

    let query = supabase
      .from('daily_records')
      .select('*, agents!inner(id, name), products!inner(id, name), channels!inner(id, name)')
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (session.role === 'agent') {
      query = query.eq('agent_id', session.agentId!).eq('product_id', session.productId!);
    } else {
      if (agentId) query = query.eq('agent_id', agentId);
      if (productId) query = query.eq('product_id', productId);
      if (channelId) query = query.eq('channel_id', channelId);
    }

    if (dateFrom) query = query.gte('record_date', dateFrom);
    if (dateTo) query = query.lte('record_date', dateTo);
    if (creativeType) query = query.ilike('creative_type', `%${creativeType}%`);
    if (promotionGoal) query = query.eq('promotion_goal', promotionGoal);

    const { data, error } = await query;
    if (error) throw error;

    const records = [];
    for (const row of data || []) {
      const raw = row as Record<string, unknown>;
      const agent = raw.agents as { name?: string } | null;
      const product = raw.products as { name?: string } | null;
      const channel = raw.channels as { name?: string } | null;
      const target = await latestTargetForRecord(
        supabase,
        raw.agent_id as string,
        raw.channel_id as string,
        raw.record_date as string,
        raw.product_id as string,
        raw.creative_type as string,
        String(raw.promotion_goal || DEFAULT_PROMOTION_GOAL)
      );

      records.push({
        ...raw,
        cpa: computedCpa(raw.cost, raw.activations),
        agent_name: agent?.name,
        product_name: product?.name,
        channel_name: channel?.name,
        target_cpa: toNumberOrNull(target?.target_cpa),
        target_retention_day1: toNumberOrNull(target?.target_retention_day1),
        target_retention_day7: toNumberOrNull(target?.target_retention_day7),
        activation_cap: toNumberOrNull(target?.activation_cap),
        is_running: target?.is_running ?? null,
        cpa_check_delta: null,
        agents: undefined,
        products: undefined,
        channels: undefined,
      });
    }

    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error('GET /api/records error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch records' }, { status: 500 });
  }
}

// POST /api/records - Create one T-1 record (agent only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'agent') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const creativeType = normalizeDictionaryName(body.creative_type);
    const promotionGoal = normalizeDictionaryName(body.promotion_goal) || DEFAULT_PROMOTION_GOAL;
    if (!creativeType || !promotionGoal) {
      return NextResponse.json({ success: false, error: '请选择体裁和投放目标' }, { status: 400 });
    }
    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        if (!isLocalScopeAuthorized(db, session.agentId!, creativeType, promotionGoal)) {
          throw new Error('该体裁/投放目标未授权，请联系管理员配置');
        }
        const existing = db.daily_records.find((record) => (
          record.agent_id === session.agentId &&
          record.product_id === session.productId &&
          record.channel_id === session.channelId &&
          record.record_date === body.record_date &&
          record.creative_type === creativeType &&
          record.promotion_goal === promotionGoal
        ));
        const timestamp = nowIso();
        if (existing) {
          Object.assign(existing, {
            cost: Number(body.cost || 0),
            activations: Number(body.activations || 0),
            cpa: computedCpa(body.cost, body.activations),
            ctr: toNumberOrNull(body.ctr),
            cvr: toNumberOrNull(body.cvr),
            cpm: toNumberOrNull(body.cpm),
            retention_day1: toNumberOrNull(body.retention_day1),
            retention_day7: toNumberOrNull(body.retention_day7),
            updated_at: timestamp,
          });
          recalculateLocalAlertsForRecordIds(db, [existing.id]);
          return decorateRecord(db, existing);
        }

        const record = {
          id: newId(),
          agent_id: session.agentId!,
          product_id: session.productId!,
          channel_id: session.channelId!,
          record_date: body.record_date,
          creative_type: creativeType,
          promotion_goal: promotionGoal,
          cost: Number(body.cost || 0),
          activations: Number(body.activations || 0),
          cpa: computedCpa(body.cost, body.activations),
          ctr: toNumberOrNull(body.ctr),
          cvr: toNumberOrNull(body.cvr),
          cpm: toNumberOrNull(body.cpm),
          retention_day1: toNumberOrNull(body.retention_day1),
          retention_day7: toNumberOrNull(body.retention_day7),
          created_by: session.agentName || null,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.daily_records.push(record);
        recalculateLocalAlertsForRecordIds(db, [record.id]);
        return decorateRecord(db, record);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const authorized = await isSupabaseScopeAuthorized(supabase, session.agentId!, creativeType, promotionGoal);
    if (!authorized) {
      return NextResponse.json({ success: false, error: '该体裁/投放目标未授权，请联系管理员配置' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('daily_records')
      .upsert({
        agent_id: session.agentId,
        product_id: session.productId,
        channel_id: session.channelId,
        record_date: body.record_date,
        creative_type: creativeType,
        promotion_goal: promotionGoal,
        cost: body.cost || 0,
        activations: body.activations || 0,
        cpa: computedCpa(body.cost, body.activations),
        ctr: toNumberOrNull(body.ctr),
        cvr: toNumberOrNull(body.cvr),
        cpm: toNumberOrNull(body.cpm),
        retention_day1: toNumberOrNull(body.retention_day1),
        retention_day7: toNumberOrNull(body.retention_day7),
        created_by: session.agentName,
      }, {
        onConflict: 'product_id,agent_id,channel_id,record_date,creative_type,promotion_goal',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await recalculateAlertsForRecordIds(supabase, [data.id]);
    await pruneSupabaseBusinessData(supabase);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/records error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create record' }, { status: 500 });
  }
}
