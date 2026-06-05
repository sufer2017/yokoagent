import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, newId, nowIso, readLocalDb } from '@/lib/local-db/store';

// GET /api/channels - List active channels (available to both roles)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const channels = db.channels
        .filter((channel) => !activeOnly || channel.is_active)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
      return NextResponse.json({ success: true, data: channels });
    }

    const supabase = createServerSupabase();
    let query = supabase
      .from('channels')
      .select('*')
      .order('name');

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/channels error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch channels' }, { status: 500 });
  }
}

// POST /api/channels - Create channel (admin only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: '请输入渠道名称' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        if (db.channels.some((channel) => channel.name === name.trim())) {
          throw new Error('渠道名称已存在');
        }
        const timestamp = nowIso();
        const channel = {
          id: newId(),
          name: name.trim(),
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.channels.push(channel);
        return channel;
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('channels')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '渠道名称已存在' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/channels error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create channel' }, { status: 500 });
  }
}
