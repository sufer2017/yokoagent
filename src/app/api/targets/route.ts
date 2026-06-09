import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { DEFAULT_PROMOTION_GOAL, normalizeDictionaryName } from '@/lib/admin/creativeTypes';
import { isSupabaseScopeAuthorized } from '@/lib/admin/scopes';
import { decorateTarget, isLocalScopeAuthorized, mutateLocalDb, newId, nowIso, readLocalDb } from '@/lib/local-db/store';

function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

// GET /api/targets - Admin target history
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const agentId = searchParams.get('agentId');
    const channelId = searchParams.get('channelId');

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const rows = db.target_changes
        .filter((target) => !productId || target.product_id === productId)
        .filter((target) => !agentId || target.agent_id === agentId)
        .filter((target) => !channelId || target.channel_id === channelId)
        .sort((left, right) => (
          right.effective_date.localeCompare(left.effective_date) ||
          right.created_at.localeCompare(left.created_at)
        ))
        .map((target) => decorateTarget(db, target));

      return NextResponse.json({ success: true, data: rows });
    }

    const supabase = createServerSupabase();
    let query = supabase
      .from('target_changes')
      .select('*, agents!inner(name), products!inner(name), channels!inner(name)')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (productId) query = query.eq('product_id', productId);
    if (agentId) query = query.eq('agent_id', agentId);
    if (channelId) query = query.eq('channel_id', channelId);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      agent_name: (row.agents as { name?: string } | null)?.name,
      product_name: (row.products as { name?: string } | null)?.name,
      channel_name: (row.channels as { name?: string } | null)?.name,
      agents: undefined,
      products: undefined,
      channels: undefined,
    }));

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('GET /api/targets error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch targets' }, { status: 500 });
  }
}

// POST /api/targets - Create target change
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const creativeType = normalizeDictionaryName(body.creative_type);
    const promotionGoal = normalizeDictionaryName(body.promotion_goal) || DEFAULT_PROMOTION_GOAL;
    if (!body.product_id || !body.agent_id || !body.channel_id || !creativeType || !promotionGoal || !body.effective_date) {
      return NextResponse.json({ success: false, error: '请选择产品、代理、渠道、体裁、投放目标和生效日期' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const agent = db.agents.find((item) => item.id === body.agent_id);
      if (!agent) {
        return NextResponse.json({ success: false, error: '代理商不存在' }, { status: 400 });
      }
      if (agent.product_id !== body.product_id || agent.channel_id !== body.channel_id) {
        return NextResponse.json({ success: false, error: '代理商与所选产品/渠道不匹配' }, { status: 400 });
      }
      if (!isLocalScopeAuthorized(db, body.agent_id, creativeType, promotionGoal)) {
        return NextResponse.json({ success: false, error: '该代理未授权此体裁/投放目标组合，请先在账号与渠道配置' }, { status: 400 });
      }

      const data = await mutateLocalDb((db) => {
        if (db.target_changes.some((target) => (
          target.agent_id === body.agent_id &&
          target.product_id === body.product_id &&
          target.channel_id === body.channel_id &&
          target.creative_type === creativeType &&
          target.promotion_goal === promotionGoal &&
          target.effective_date === body.effective_date
        ))) {
          throw new Error('该产品/渠道/代理/体裁/投放目标在该生效日期已有考核记录');
        }
        const timestamp = nowIso();
        const target = {
          id: newId(),
          agent_id: body.agent_id,
          product_id: body.product_id,
          channel_id: body.channel_id,
          creative_type: creativeType,
          promotion_goal: promotionGoal,
          effective_date: body.effective_date,
          is_running: body.is_running ?? true,
          target_cpa: toNumberOrNull(body.target_cpa),
          target_retention_day1: toNumberOrNull(body.target_retention_day1),
          target_retention_day7: toNumberOrNull(body.target_retention_day7),
          activation_cap: toNumberOrNull(body.activation_cap),
          note: body.note || null,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.target_changes.push(target);
        return decorateTarget(db, target);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('product_id, channel_id')
      .eq('id', body.agent_id)
      .maybeSingle();

    if (agentError) throw agentError;
    if (!agent) {
      return NextResponse.json({ success: false, error: '代理商不存在' }, { status: 400 });
    }
    if (agent.product_id !== body.product_id || agent.channel_id !== body.channel_id) {
      return NextResponse.json({ success: false, error: '代理商与所选产品/渠道不匹配' }, { status: 400 });
    }
    const authorized = await isSupabaseScopeAuthorized(supabase, body.agent_id, creativeType, promotionGoal);
    if (!authorized) {
      return NextResponse.json({ success: false, error: '该代理未授权此体裁/投放目标组合，请先在账号与渠道配置' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('target_changes')
      .insert({
        agent_id: body.agent_id,
        product_id: body.product_id,
        channel_id: body.channel_id,
        creative_type: creativeType,
        promotion_goal: promotionGoal,
        effective_date: body.effective_date,
        is_running: body.is_running ?? true,
        target_cpa: toNumberOrNull(body.target_cpa),
        target_retention_day1: toNumberOrNull(body.target_retention_day1),
        target_retention_day7: toNumberOrNull(body.target_retention_day7),
        activation_cap: toNumberOrNull(body.activation_cap),
        note: body.note || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '该代理在该体裁/投放目标/生效日期已有考核记录' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/targets error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create target' }, { status: 500 });
  }
}
