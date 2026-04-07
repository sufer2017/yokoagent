import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// PATCH /api/constraints/[id]
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
    if (body.name !== undefined) updateData.name = body.name;
    if (body.value !== undefined) updateData.value = body.value;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.metric !== undefined) updateData.metric = body.metric;
    if (body.operator !== undefined) updateData.operator = body.operator;

    const { data, error } = await supabase
      .from('constraints')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/constraints/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update constraint' }, { status: 500 });
  }
}

// DELETE /api/constraints/[id] - Only custom constraints can be deleted
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

    // Check if it's a hard constraint
    const { data: constraint } = await supabase
      .from('constraints')
      .select('type')
      .eq('id', id)
      .single();

    if (constraint?.type === 'hard') {
      return NextResponse.json(
        { success: false, error: '硬性约束不可删除，只能修改阈值' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('constraints')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/constraints/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete constraint' }, { status: 500 });
  }
}
