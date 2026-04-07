import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/agents - List agents
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';

    const supabase = createServerSupabase();
    let query = supabase.from('agents').select('*').order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/agents error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// POST /api/agents - Create agent
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: '请输入代理名称' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('agents')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '代理名称已存在' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/agents error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create agent' }, { status: 500 });
  }
}
