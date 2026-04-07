import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a pre-filtered query for agent data isolation.
 * All agent-facing queries MUST use this helper to ensure data isolation.
 */
export function agentRecordsQuery(supabase: SupabaseClient, agentId: string) {
  return supabase
    .from('daily_records')
    .select('*')
    .eq('agent_id', agentId);
}

/**
 * Verify that a record belongs to the given agent.
 */
export async function verifyRecordOwnership(
  supabase: SupabaseClient,
  recordId: string,
  agentId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('daily_records')
    .select('id')
    .eq('id', recordId)
    .eq('agent_id', agentId)
    .single();

  return !!data;
}
