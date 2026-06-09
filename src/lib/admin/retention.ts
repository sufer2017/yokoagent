import type { SupabaseClient } from '@supabase/supabase-js';
import { addDateDays, defaultBusinessAnchorDate } from '@/lib/admin/dates';

export function businessDataCutoff(anchorDate = defaultBusinessAnchorDate()) {
  return addDateDays(anchorDate, -20);
}

export async function pruneSupabaseBusinessData(
  supabase: SupabaseClient,
  anchorDate = defaultBusinessAnchorDate()
) {
  const cutoff = businessDataCutoff(anchorDate);

  const { data: oldAlerts, error: oldAlertError } = await supabase
    .from('alert_results')
    .select('id')
    .lt('record_date', cutoff);
  if (oldAlertError) throw oldAlertError;

  const { data: oldRecords, error: oldRecordError } = await supabase
    .from('daily_records')
    .select('id')
    .lt('record_date', cutoff);
  if (oldRecordError) throw oldRecordError;

  return {
    cutoff,
    deleted_daily_records: 0,
    deleted_alert_results: 0,
    retained_daily_records_before_cutoff: oldRecords?.length || 0,
    retained_alert_results_before_cutoff: oldAlerts?.length || 0,
    mode: 'read_only_retention_check',
  };
}
