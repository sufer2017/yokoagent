import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// PATCH /api/budgets/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = createServerSupabase();

    const updateData: Record<string, unknown> = {};
    if (body.budget_amount !== undefined) updateData.budget_amount = body.budget_amount;
    if (body.period_start !== undefined) updateData.period_start = body.period_start;
    if (body.period_end !== undefined) updateData.period_end = body.period_end;

    if (body.budget_amount !== undefined) {
      const { data: allocations, error: allocationError } = await supabase
        .from('agent_channel_allocations')
        .select('spending_cap, channel_budgets!inner(id)')
        .eq('channel_budget_id', id);

      if (allocationError) throw allocationError;

      const allocatedTotal = (allocations || []).reduce(
        (sum: number, allocation: Record<string, unknown>) => sum + Number(allocation.spending_cap || 0),
        0
      );

      if (allocatedTotal > Number(body.budget_amount)) {
        return NextResponse.json(
          {
            success: false,
            error: `新的渠道预算不能低于已分配总额 ¥${allocatedTotal.toFixed(2)}`,
          },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from('channel_budgets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/budgets/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update budget' }, { status: 500 });
  }
}

// DELETE /api/budgets/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const supabase = createServerSupabase();

    const { error } = await supabase
      .from('channel_budgets')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/budgets/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete budget' }, { status: 500 });
  }
}
