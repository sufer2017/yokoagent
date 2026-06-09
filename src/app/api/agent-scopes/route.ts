import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { localActiveScopesForAgent, readLocalDb } from '@/lib/local-db/store';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const requestedAgentId = searchParams.get('agentId');
    const agentId = session.role === 'agent' ? session.agentId : requestedAgentId;
    if (!agentId) {
      return NextResponse.json({ success: false, error: '缺少代理商' }, { status: 400 });
    }
    if (session.role !== 'admin' && session.agentId !== agentId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      return NextResponse.json({ success: true, data: localActiveScopesForAgent(db, agentId) });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('agent_authorized_scopes')
      .select('id, agent_id, creative_type, promotion_goal, is_active')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .order('creative_type')
      .order('promotion_goal');
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('GET /api/agent-scopes error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agent scopes' }, { status: 500 });
  }
}
