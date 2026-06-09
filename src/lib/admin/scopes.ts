import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_PROMOTION_GOAL,
  normalizeAuthorizedScopes,
  normalizeCreativeTypes,
  normalizeDictionaryName,
} from '@/lib/admin/creativeTypes';

export interface AgentScope {
  creative_type: string;
  promotion_goal: string;
  is_active: boolean;
}

export function normalizeScopePayload(body: Record<string, unknown>) {
  return normalizeAuthorizedScopes(body.authorized_scopes, body.creative_types);
}

export function creativeTypesFromScopes(scopes: AgentScope[]) {
  return normalizeCreativeTypes(scopes.filter((scope) => scope.is_active).map((scope) => scope.creative_type));
}

export async function upsertSupabaseDictionaries(supabase: SupabaseClient, scopes: AgentScope[]) {
  const creativeTypes = Array.from(new Set(scopes.map((scope) => scope.creative_type).filter(Boolean)));
  const promotionGoals = Array.from(new Set(scopes.map((scope) => scope.promotion_goal).filter(Boolean)));
  if (creativeTypes.length > 0) {
    const { error } = await supabase
      .from('creative_types')
      .upsert(creativeTypes.map((name) => ({ name, is_active: true })), { onConflict: 'name' });
    if (error) throw error;
  }
  if (promotionGoals.length > 0) {
    const { error } = await supabase
      .from('promotion_goals')
      .upsert(promotionGoals.map((name) => ({ name, is_active: true })), { onConflict: 'name' });
    if (error) throw error;
  }
}

export async function replaceSupabaseAgentScopes(
  supabase: SupabaseClient,
  agentId: string,
  scopes: AgentScope[]
) {
  await upsertSupabaseDictionaries(supabase, scopes);
  const { error: deleteError } = await supabase
    .from('agent_authorized_scopes')
    .delete()
    .eq('agent_id', agentId);
  if (deleteError) throw deleteError;

  if (scopes.length === 0) return;
  const { error: insertError } = await supabase
    .from('agent_authorized_scopes')
    .insert(scopes.map((scope) => ({
      agent_id: agentId,
      creative_type: scope.creative_type,
      promotion_goal: scope.promotion_goal,
      is_active: scope.is_active,
    })));
  if (insertError) throw insertError;
}

export async function fetchSupabaseAgentScopes(supabase: SupabaseClient, agentIds: string[]) {
  const ids = Array.from(new Set(agentIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, AgentScope[]>();
  const { data, error } = await supabase
    .from('agent_authorized_scopes')
    .select('id, agent_id, creative_type, promotion_goal, is_active, created_at, updated_at')
    .in('agent_id', ids)
    .order('creative_type')
    .order('promotion_goal');
  if (error) throw error;

  const byAgentId = new Map<string, AgentScope[]>();
  for (const row of data || []) {
    const raw = row as Record<string, unknown>;
    const agentId = String(raw.agent_id || '');
    const scope = {
      id: String(raw.id || ''),
      agent_id: agentId,
      creative_type: String(raw.creative_type || ''),
      promotion_goal: String(raw.promotion_goal || DEFAULT_PROMOTION_GOAL),
      is_active: raw.is_active !== false,
      created_at: raw.created_at == null ? undefined : String(raw.created_at),
      updated_at: raw.updated_at == null ? undefined : String(raw.updated_at),
    };
    byAgentId.set(agentId, [...(byAgentId.get(agentId) || []), scope]);
  }
  return byAgentId;
}

export async function isSupabaseScopeAuthorized(
  supabase: SupabaseClient,
  agentId: string,
  creativeType: unknown,
  promotionGoal: unknown
) {
  const creative = normalizeDictionaryName(creativeType);
  const goal = normalizeDictionaryName(promotionGoal) || DEFAULT_PROMOTION_GOAL;
  if (!agentId || !creative || !goal) return false;
  const { data, error } = await supabase
    .from('agent_authorized_scopes')
    .select('id')
    .eq('agent_id', agentId)
    .eq('creative_type', creative)
    .eq('promotion_goal', goal)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
