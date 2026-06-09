import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { cascadeDeleteAgents, decorateAgent, mutateLocalDb, nowIso, replaceLocalAgentScopes } from '@/lib/local-db/store';
import { normalizeAuthorizedScopes } from '@/lib/admin/creativeTypes';
import { creativeTypesFromScopes, normalizeScopePayload, replaceSupabaseAgentScopes } from '@/lib/admin/scopes';

// PATCH /api/agents/[id]
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

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.username !== undefined) updateData.username = body.username.trim();
    if (body.feishu_webhook !== undefined) updateData.feishu_webhook = body.feishu_webhook?.trim() || '';
    if (body.product_id !== undefined) updateData.product_id = body.product_id;
    if (body.channel_id !== undefined) updateData.channel_id = body.channel_id;
    const hasScopes = Object.prototype.hasOwnProperty.call(body, 'authorized_scopes')
      || Object.prototype.hasOwnProperty.call(body, 'creative_types');
    const authorizedScopes = hasScopes ? normalizeScopePayload(body) : null;
    if (authorizedScopes) {
      if (authorizedScopes.length === 0) {
        return NextResponse.json({ success: false, error: '请至少配置一个体裁和投放目标组合' }, { status: 400 });
      }
      updateData.creative_types = creativeTypesFromScopes(authorizedScopes);
    }
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    const nextPassword = typeof body.password === 'string' ? body.password.trim() : '';
    if (nextPassword) {
      updateData.password_hash = await hashPassword(nextPassword);
      updateData.password_plaintext = nextPassword;
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const agent = db.agents.find((item) => item.id === id);
        if (!agent) throw new Error('Agent not found');
        Object.assign(agent, updateData, { updated_at: nowIso() });
        if (authorizedScopes) {
          replaceLocalAgentScopes(db, id, normalizeAuthorizedScopes(authorizedScopes));
        }
        return decorateAgent(db, agent);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .select('id, product_id, channel_id, name, username, creative_types, feishu_webhook, password_plaintext, is_active, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '代理名称已存在' }, { status: 409 });
      }
      throw error;
    }
    if (authorizedScopes) {
      await replaceSupabaseAgentScopes(supabase, id, authorizedScopes);
    }

    return NextResponse.json({ success: true, data: { ...data, authorized_scopes: authorizedScopes || undefined } });
  } catch (error) {
    console.error('PATCH /api/agents/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id] - Physical delete
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!hasSupabaseConfig()) {
      await mutateLocalDb((db) => {
        cascadeDeleteAgents(db, [id]);
      });

      return NextResponse.json({ success: true });
    }

    const supabase = createServerSupabase();

    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/agents/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete agent' }, { status: 500 });
  }
}
