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

  const { error: deleteAlertsError } = await supabase
    .from('alert_results')
    .delete()
    .lt('record_date', cutoff);
  if (deleteAlertsError) throw deleteAlertsError;

  const { data: oldRecords, error: oldRecordError } = await supabase
    .from('daily_records')
    .select('id')
    .lt('record_date', cutoff);
  if (oldRecordError) throw oldRecordError;

  const { error: deleteRecordsError } = await supabase
    .from('daily_records')
    .delete()
    .lt('record_date', cutoff);
  if (deleteRecordsError) throw deleteRecordsError;

  return {
    cutoff,
    deleted_daily_records: oldRecords?.length || 0,
    deleted_alert_results: oldAlerts?.length || 0,
  };
}
