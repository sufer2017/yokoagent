import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/constraints - List all constraints
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('constraints')
      .select('*')
      .order('type')
      .order('created_at');

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/constraints error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch constraints' }, { status: 500 });
  }
}

// POST /api/constraints - Create custom constraint (admin only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, metric, operator, value } = body;

    if (!name?.trim() || !metric || !operator || value == null) {
      return NextResponse.json({ success: false, error: '请填写所有必填字段' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('constraints')
      .insert({
        name: name.trim(),
        type: 'custom',
        metric,
        operator,
        value,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/constraints error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create constraint' }, { status: 500 });
  }
}
