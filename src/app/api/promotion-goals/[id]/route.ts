import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, nowIso } from '@/lib/local-db/store';

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

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const item = db.promotion_goals.find((entry) => entry.id === id);
        if (!item) throw new Error('Promotion goal not found');
        if (body.is_active !== undefined) item.is_active = Boolean(body.is_active);
        item.updated_at = nowIso();
        return item;
      });
      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const updateData: Record<string, unknown> = {};
    if (body.is_active !== undefined) updateData.is_active = Boolean(body.is_active);
    const { data, error } = await supabase
      .from('promotion_goals')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/promotion-goals/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update promotion goal' }, { status: 500 });
  }
}
