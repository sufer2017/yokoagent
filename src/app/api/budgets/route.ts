import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/budgets - List channel budgets with channel names
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('channel_budgets')
      .select(`
        *,
        channels!inner(name)
      `)
      .order('period_start', { ascending: false });

    if (error) throw error;

    const budgets = (data || []).map((row: Record<string, unknown>) => {
      const channels = row.channels as { name: string } | null;
      return {
        ...row,
        channel_name: channels?.name,
        channels: undefined,
      };
    });

    return NextResponse.json({ success: true, data: budgets });
  } catch (error) {
    console.error('GET /api/budgets error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch budgets' }, { status: 500 });
  }
}

// POST /api/budgets - Create channel budget
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { channel_id, budget_amount, period_start, period_end } = body;

    if (!channel_id || budget_amount == null || !period_start || !period_end) {
      return NextResponse.json({ success: false, error: '请填写所有必填字段' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('channel_budgets')
      .insert({
        channel_id,
        budget_amount,
        period_start,
        period_end,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: '该渠道在此时间段已有预算设置' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/budgets error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create budget' }, { status: 500 });
  }
}
