import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { decorateAgent, mutateLocalDb, newId, nowIso, readLocalDb } from '@/lib/local-db/store';
import { generateAgentPassword } from '@/lib/admin/passwords';
import { normalizeAuthorizedScopes } from '@/lib/admin/creativeTypes';
import {
  creativeTypesFromScopes,
  fetchSupabaseAgentScopes,
  normalizeScopePayload,
  replaceSupabaseAgentScopes,
} from '@/lib/admin/scopes';

// GET /api/agents - List agents
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';
    const productId = searchParams.get('productId');

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const agents = db.agents
        .filter((agent) => !activeOnly || agent.is_active)
        .filter((agent) => !productId || agent.product_id === productId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .map((agent) => decorateAgent(db, agent));

      return NextResponse.json({ success: true, data: agents });
    }

    const supabase = createServerSupabase();
    let query = supabase
      .from('agents')
      .select('id, product_id, channel_id, name, username, creative_types, feishu_webhook, password_plaintext, is_active, created_at, updated_at, products(name), channels(name)')
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    if (productId) query = query.eq('product_id', productId);

    const { data, error } = await query;
    if (error) throw error;
    const scopesByAgentId = await fetchSupabaseAgentScopes(supabase, (data || []).map((row: Record<string, unknown>) => String(row.id)));

    const agents = (data || []).map((row: Record<string, unknown>) => {
      const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels as { name?: string } | null;
      const product = Array.isArray(row.products) ? row.products[0] : row.products as { name?: string } | null;
      const authorizedScopes = scopesByAgentId.get(String(row.id)) || normalizeAuthorizedScopes([], row.creative_types);
      return {
        ...row,
        creative_types: creativeTypesFromScopes(authorizedScopes),
        authorized_scopes: authorizedScopes,
        product_name: product?.name,
        channel_name: channel?.name,
        products: undefined,
        channels: undefined,
      };
    });

    return NextResponse.json({ success: true, data: agents });
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

    const body = await request.json();
    const { name, username, password, product_id, channel_id, feishu_webhook } = body;
    const authorizedScopes = normalizeScopePayload(body);
    if (!name?.trim() || !username?.trim() || !product_id || !channel_id) {
      return NextResponse.json({ success: false, error: '请输入产品、代理名称、账号和渠道' }, { status: 400 });
    }
    if (authorizedScopes.length === 0) {
      return NextResponse.json({ success: false, error: '请至少配置一个体裁和投放目标组合' }, { status: 400 });
    }
    const creativeTypes = creativeTypesFromScopes(authorizedScopes);

    const initialPassword = String(password || '').trim() || generateAgentPassword();
    const password_hash = await hashPassword(initialPassword);
    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        if (db.agents.some((agent) => agent.username === username.trim())) {
          throw new Error('代理账号已存在');
        }
        if (db.agents.some((agent) => agent.product_id === product_id && agent.channel_id === channel_id && agent.name === name.trim())) {
          throw new Error('代理名称已存在');
        }
        const timestamp = nowIso();
        const agent = {
          id: newId(),
          product_id,
          name: name.trim(),
          username: username.trim(),
          creative_types: creativeTypes,
          feishu_webhook: feishu_webhook?.trim() || '',
          password_hash,
          password_plaintext: initialPassword,
          channel_id,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.agents.push(agent);
        const normalizedScopes = normalizeAuthorizedScopes(authorizedScopes);
        db.agent_authorized_scopes.push(...normalizedScopes.map((scope) => ({
          id: newId(),
          agent_id: agent.id,
          creative_type: scope.creative_type,
          promotion_goal: scope.promotion_goal,
          is_active: scope.is_active,
          created_at: timestamp,
          updated_at: timestamp,
        })));
        for (const scope of normalizedScopes) {
          if (!db.creative_types.some((item) => item.name === scope.creative_type)) {
            db.creative_types.push({ id: newId(), name: scope.creative_type, is_active: true, created_at: timestamp, updated_at: timestamp });
          }
          if (!db.promotion_goals.some((item) => item.name === scope.promotion_goal)) {
            db.promotion_goals.push({ id: newId(), name: scope.promotion_goal, is_active: true, created_at: timestamp, updated_at: timestamp });
          }
        }
        return decorateAgent(db, agent);
      });

      return NextResponse.json({ success: true, data: { ...data, initial_password: initialPassword } });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('agents')
      .insert({
        name: name.trim(),
        username: username.trim(),
        creative_types: creativeTypes,
        feishu_webhook: feishu_webhook?.trim() || '',
        password_hash,
        password_plaintext: initialPassword,
        product_id,
        channel_id,
      })
      .select('id, product_id, channel_id, name, username, creative_types, feishu_webhook, password_plaintext, is_active, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '代理名称已存在' }, { status: 409 });
      }
      throw error;
    }
    await replaceSupabaseAgentScopes(supabase, data.id, authorizedScopes);

    return NextResponse.json({ success: true, data: { ...data, authorized_scopes: authorizedScopes, initial_password: initialPassword } });
  } catch (error) {
    console.error('POST /api/agents error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create agent' }, { status: 500 });
  }
}
