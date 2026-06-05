import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import {
  decorateRecord,
  computedCpa,
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
  creativeType: string
) {
  const { data } = await supabase
    .from('target_changes')
    .select('target_cpa, target_retention_day1, target_retention_day7, activation_cap, is_running')
    .eq('agent_id', agentId)
    .eq('product_id', productId)
    .eq('channel_id', channelId)
    .eq('creative_type', creativeType)
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
        raw.creative_type as string
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
    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        if (db.daily_records.some((record) => (
          record.agent_id === session.agentId &&
          record.product_id === session.productId &&
          record.channel_id === session.channelId &&
          record.record_date === body.record_date &&
          record.creative_type === String(body.creative_type || '').trim()
        ))) {
          throw new Error('该日期/体裁已存在记录，请直接编辑');
        }

        const timestamp = nowIso();
        const record = {
          id: newId(),
          agent_id: session.agentId!,
          product_id: session.productId!,
          channel_id: session.channelId!,
          record_date: body.record_date,
          creative_type: String(body.creative_type || '').trim(),
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

    const { data, error } = await supabase
      .from('daily_records')
      .insert({
        agent_id: session.agentId,
        product_id: session.productId,
        channel_id: session.channelId,
        record_date: body.record_date,
        creative_type: String(body.creative_type || '').trim(),
        cost: body.cost || 0,
        activations: body.activations || 0,
        cpa: computedCpa(body.cost, body.activations),
        ctr: toNumberOrNull(body.ctr),
        cvr: toNumberOrNull(body.cvr),
        cpm: toNumberOrNull(body.cpm),
        retention_day1: toNumberOrNull(body.retention_day1),
        retention_day7: toNumberOrNull(body.retention_day7),
        created_by: session.agentName,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: '该日期/体裁已存在记录，请直接编辑' },
          { status: 409 }
        );
      }
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
