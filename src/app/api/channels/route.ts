import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/channels - List active channels (available to both roles)
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('is_active', true)
      .order('name');

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
