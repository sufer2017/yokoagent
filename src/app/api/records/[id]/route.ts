import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { verifyRecordOwnership } from '@/lib/helpers/agentQuery';

// PATCH /api/records/[id] - Update a record
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = createServerSupabase();

    // Agents can only update their own records
    if (session.role === 'agent') {
      const isOwner = await verifyRecordOwnership(supabase, id, session.agentId!);
      if (!isOwner) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.record_date !== undefined) updateData.record_date = body.record_date;
    if (body.channel_id !== undefined) updateData.channel_id = body.channel_id;
    if (body.project_id !== undefined) updateData.project_id = body.project_id;
    if (body.cost !== undefined) updateData.cost = body.cost;
    if (body.activations !== undefined) updateData.activations = body.activations;
    if (body.retention_day1 !== undefined) updateData.retention_day1 = body.retention_day1;
    if (body.retention_day7 !== undefined) updateData.retention_day7 = body.retention_day7;

    const { data, error } = await supabase
      .from('daily_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/records/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update record' }, { status: 500 });
  }
}

// DELETE /api/records/[id] - Delete a record
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = createServerSupabase();

    // Agents can only delete their own records
    if (session.role === 'agent') {
      const isOwner = await verifyRecordOwnership(supabase, id, session.agentId!);
      if (!isOwner) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { error } = await supabase
      .from('daily_records')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/records/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete record' }, { status: 500 });
  }
}
