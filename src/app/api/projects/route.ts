import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/projects - List active projects
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/projects error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch projects' }, { status: 500 });
  }
}

// POST /api/projects - Create project (admin only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: '请输入项目名称' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: name.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '项目名称已存在' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/projects error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create project' }, { status: 500 });
  }
}
