import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

// GET /api/records - List records with filters
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const channelId = searchParams.get('channelId');
    const projectId = searchParams.get('projectId');
    const agentId = searchParams.get('agentId');

    const supabase = createServerSupabase();

    let query = supabase
      .from('daily_records')
      .select(`
        *,
        agents!inner(name),
        channels!inner(name),
        projects!inner(name)
      `)
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Data isolation: agents can only see their own data
    if (session.role === 'agent') {
      query = query.eq('agent_id', session.agentId!);
    } else if (agentId) {
      // Admin can filter by specific agent
      query = query.eq('agent_id', agentId);
    }

    if (dateFrom) query = query.gte('record_date', dateFrom);
    if (dateTo) query = query.lte('record_date', dateTo);
    if (channelId) query = query.eq('channel_id', channelId);
    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) throw error;

    // Transform to include computed fields and flatten joined names
    const records = (data || []).map((row: Record<string, unknown>) => {
      const agents = row.agents as { name: string } | null;
      const channels = row.channels as { name: string } | null;
      const projects = row.projects as { name: string } | null;
      const cost = row.cost as number;
      const activations = row.activations as number;

      return {
        ...row,
        agent_name: agents?.name,
        channel_name: channels?.name,
        project_name: projects?.name,
        activation_cost: activations > 0 ? Number((cost / activations).toFixed(2)) : null,
        // Remove nested objects
        agents: undefined,
        channels: undefined,
        projects: undefined,
      };
    });

    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error('GET /api/records error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch records' }, { status: 500 });
  }
}

// POST /api/records - Create a single record (agent only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'agent') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('daily_records')
      .insert({
        agent_id: session.agentId,
        record_date: body.record_date,
        channel_id: body.channel_id,
        project_id: body.project_id,
        cost: body.cost || 0,
        activations: body.activations || 0,
        retention_day1: body.retention_day1,
        retention_day7: body.retention_day7,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: '该日期/渠道/项目组合已存在记录，请直接编辑' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/records error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create record' }, { status: 500 });
  }
}
