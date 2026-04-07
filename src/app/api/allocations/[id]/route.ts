import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// PATCH /api/allocations/[id]
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

    if (body.spending_cap !== undefined) {
      const { data: currentAllocation, error: currentAllocationError } = await supabase
        .from('agent_channel_allocations')
        .select('channel_budget_id, spending_cap')
        .eq('id', id)
        .single();

      if (currentAllocationError) throw currentAllocationError;

      const { data: budget, error: budgetError } = await supabase
        .from('channel_budgets')
        .select('budget_amount')
        .eq('id', currentAllocation.channel_budget_id)
        .single();

      if (budgetError) throw budgetError;

      const { data: siblingAllocations, error: siblingError } = await supabase
        .from('agent_channel_allocations')
        .select('id, spending_cap')
        .eq('channel_budget_id', currentAllocation.channel_budget_id);

      if (siblingError) throw siblingError;

      const siblingTotal = (siblingAllocations || []).reduce((sum: number, allocation: Record<string, unknown>) => {
        if (allocation.id === id) {
          return sum;
        }

        return sum + Number(allocation.spending_cap || 0);
      }, 0);

      if (siblingTotal + Number(body.spending_cap) > Number(budget.budget_amount)) {
        return NextResponse.json(
          {
            success: false,
            error: `更新后将超出渠道预算。剩余可分配额度: ¥${(Number(budget.budget_amount) - siblingTotal).toFixed(2)}`,
          },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.spending_cap !== undefined) updateData.spending_cap = body.spending_cap;
    if (body.activation_floor !== undefined) updateData.activation_floor = body.activation_floor;

    const { data, error } = await supabase
      .from('agent_channel_allocations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/allocations/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update allocation' }, { status: 500 });
  }
}

// DELETE /api/allocations/[id]
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
      .from('agent_channel_allocations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/allocations/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete allocation' }, { status: 500 });
  }
}
