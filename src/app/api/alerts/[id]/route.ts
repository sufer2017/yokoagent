import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { decorateAlert, mutateLocalDb, nowIso } from '@/lib/local-db/store';

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
    const status = body.status;

    if (!['open', 'acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json({ success: false, error: '无效状态' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const alert = db.alert_results.find((item) => item.id === id);
        if (!alert) throw new Error('Alert not found');
        alert.status = status;
        alert.updated_at = nowIso();
        return decorateAlert(db, alert);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('alert_results')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/alerts/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update alert' }, { status: 500 });
  }
}
