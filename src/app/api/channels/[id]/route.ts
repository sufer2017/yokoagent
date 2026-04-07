import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// PATCH /api/channels/[id]
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
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data, error } = await supabase
      .from('channels')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/channels/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update channel' }, { status: 500 });
  }
}

// DELETE /api/channels/[id]
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

    // Soft delete: set is_active = false
    const { error } = await supabase
      .from('channels')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/channels/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete channel' }, { status: 500 });
  }
}
