import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { decorateTarget, mutateLocalDb, nowIso } from '@/lib/local-db/store';

function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

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
    const updateData: Record<string, unknown> = {};
    if (body.product_id !== undefined) updateData.product_id = body.product_id;
    if (body.agent_id !== undefined) updateData.agent_id = body.agent_id;
    if (body.channel_id !== undefined) updateData.channel_id = body.channel_id;
    if (body.creative_type !== undefined) updateData.creative_type = String(body.creative_type).trim();
    if (body.effective_date !== undefined) updateData.effective_date = body.effective_date;
    if (body.is_running !== undefined) updateData.is_running = body.is_running;
    if (body.target_cpa !== undefined) updateData.target_cpa = toNumberOrNull(body.target_cpa);
    if (body.target_retention_day1 !== undefined) updateData.target_retention_day1 = toNumberOrNull(body.target_retention_day1);
    if (body.target_retention_day7 !== undefined) updateData.target_retention_day7 = toNumberOrNull(body.target_retention_day7);
    if (body.activation_cap !== undefined) updateData.activation_cap = toNumberOrNull(body.activation_cap);
    if (body.note !== undefined) updateData.note = body.note || null;

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const target = db.target_changes.find((item) => item.id === id);
        if (!target) throw new Error('Target not found');
        Object.assign(target, updateData, { updated_at: nowIso() });
        return decorateTarget(db, target);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('target_changes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/targets/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update target' }, { status: 500 });
  }
}

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
    if (!hasSupabaseConfig()) {
      await mutateLocalDb((db) => {
        db.target_changes = db.target_changes.filter((target) => target.id !== id);
      });

      return NextResponse.json({ success: true });
    }

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('target_changes')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/targets/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete target' }, { status: 500 });
  }
}
