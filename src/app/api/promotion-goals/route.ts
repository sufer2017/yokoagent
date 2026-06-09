import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, newId, nowIso, readLocalDb } from '@/lib/local-db/store';
import { normalizeDictionaryName } from '@/lib/admin/creativeTypes';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const activeOnly = new URL(request.url).searchParams.get('active') !== 'false';

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      return NextResponse.json({
        success: true,
        data: db.promotion_goals.filter((item) => !activeOnly || item.is_active),
      });
    }

    const supabase = createServerSupabase();
    let query = supabase.from('promotion_goals').select('*').order('name');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('GET /api/promotion-goals error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch promotion goals' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();
    const name = normalizeDictionaryName(body.name);
    if (!name) {
      return NextResponse.json({ success: false, error: '请输入投放目标名称' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const existing = db.promotion_goals.find((item) => item.name === name);
        if (existing) {
          existing.is_active = true;
          existing.updated_at = nowIso();
          return existing;
        }
        const timestamp = nowIso();
        const item = { id: newId(), name, is_active: true, created_at: timestamp, updated_at: timestamp };
        db.promotion_goals.push(item);
        return item;
      });
      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('promotion_goals')
      .upsert({ name, is_active: true }, { onConflict: 'name' })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/promotion-goals error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save promotion goal' }, { status: 500 });
  }
}
