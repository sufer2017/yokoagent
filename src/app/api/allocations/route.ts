import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/allocations - List allocations (optionally by channel_budget_id)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const channelBudgetId = searchParams.get('channelBudgetId');

    const supabase = createServerSupabase();

    let query = supabase
      .from('agent_channel_allocations')
      .select(`
        *,
        agents!inner(name)
      `)
      .order('created_at');

    if (channelBudgetId) {
      query = query.eq('channel_budget_id', channelBudgetId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const allocations = (data || []).map((row: Record<string, unknown>) => {
      const agents = row.agents as { name: string } | null;
      return {
        ...row,
        agent_name: agents?.name,
        agents: undefined,
      };
    });

    return NextResponse.json({ success: true, data: allocations });
  } catch (error) {
    console.error('GET /api/allocations error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch allocations' }, { status: 500 });
  }
}

// POST /api/allocations - Create allocation
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { channel_budget_id, agent_id, spending_cap, activation_floor } = body;

    if (!channel_budget_id || !agent_id || spending_cap == null) {
      return NextResponse.json({ success: false, error: '请填写所有必填字段' }, { status: 400 });
    }

    const supabase = createServerSupabase();

    // Validate: total allocations should not exceed channel budget
    const { data: budget } = await supabase
      .from('channel_budgets')
      .select('budget_amount')
      .eq('id', channel_budget_id)
      .single();

    const { data: existing } = await supabase
      .from('agent_channel_allocations')
      .select('spending_cap')
      .eq('channel_budget_id', channel_budget_id);

    const currentTotal = (existing || []).reduce((sum: number, a: Record<string, unknown>) => sum + Number(a.spending_cap || 0), 0);
    if (budget && currentTotal + Number(spending_cap) > Number(budget.budget_amount)) {
      return NextResponse.json(
        { success: false, error: `分配总额超出渠道预算。可用额度: ¥${(Number(budget.budget_amount) - currentTotal).toFixed(2)}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('agent_channel_allocations')
      .insert({
        channel_budget_id,
        agent_id,
        spending_cap,
        activation_floor: activation_floor || 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: '该代理在此渠道预算中已有分配' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/allocations error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create allocation' }, { status: 500 });
  }
}
