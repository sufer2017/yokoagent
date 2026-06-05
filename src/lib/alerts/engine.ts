import type { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';

interface DailyRecordRow {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  creative_type: string;
  cost: number | string | null;
  activations: number | string | null;
  cpa: number | string | null;
  ctr: number | string | null;
  cvr: number | string | null;
  cpm: number | string | null;
  retention_day1: number | string | null;
  retention_day7: number | string | null;
}

interface TargetChangeRow {
  target_cpa: number | string | null;
  target_retention_day1: number | string | null;
  target_retention_day7: number | string | null;
  activation_cap: number | string | null;
}

type MetricKey =
  | 'cost'
  | 'activations'
  | 'cpa'
  | 'ctr'
  | 'cvr'
  | 'cpm'
  | 'retention_day1'
  | 'retention_day7';

const METRIC_KEYS: MetricKey[] = [
  'cost',
  'activations',
  'cpa',
  'ctr',
  'cvr',
  'cpm',
  'retention_day1',
  'retention_day7',
];

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function metricValue(record: DailyRecordRow | null, key: MetricKey): number | null {
  if (!record) return null;
  if (key === 'cpa' && record.cpa == null) {
    const cost = toNumber(record.cost);
    const activations = toNumber(record.activations);
    return cost != null && activations && activations > 0 ? cost / activations : null;
  }
  return toNumber(record[key]);
}

function percentDelta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function round4(value: number | null): number | null {
  if (value == null) return null;
  return Number(value.toFixed(4));
}

function formatSignedPercent(value: number | null): string {
  if (value == null) return '无基线';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

async function fetchRecord(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from('daily_records')
    .select('id, agent_id, product_id, channel_id, record_date, creative_type, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw error || new Error(`Record ${id} not found`);
  }

  return data as DailyRecordRow;
}

async function fetchBaseline(supabase: SupabaseClient, record: DailyRecordRow, days: number) {
  const targetDate = dayjs(record.record_date).subtract(days, 'day').format('YYYY-MM-DD');
  const { data } = await supabase
    .from('daily_records')
    .select('id, agent_id, product_id, channel_id, record_date, creative_type, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7')
    .eq('agent_id', record.agent_id)
    .eq('product_id', record.product_id)
    .eq('channel_id', record.channel_id)
    .eq('creative_type', record.creative_type)
    .eq('record_date', targetDate)
    .maybeSingle();

  return (data || null) as DailyRecordRow | null;
}

async function fetchLatestTarget(supabase: SupabaseClient, record: DailyRecordRow) {
  const { data } = await supabase
    .from('target_changes')
    .select('target_cpa, target_retention_day1, target_retention_day7, activation_cap')
    .eq('agent_id', record.agent_id)
    .eq('product_id', record.product_id)
    .eq('channel_id', record.channel_id)
    .eq('creative_type', record.creative_type)
    .lte('effective_date', record.record_date)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data || null) as TargetChangeRow | null;
}

async function fetchExistingStatus(supabase: SupabaseClient, recordId: string) {
  const { data } = await supabase
    .from('alert_results')
    .select('status')
    .eq('daily_record_id', recordId)
    .maybeSingle();

  const status = (data as { status?: string } | null)?.status;
  return status === 'acknowledged' || status === 'resolved' ? status : 'open';
}

export async function recalculateAlertsForRecordIds(
  supabase: SupabaseClient,
  recordIds: string[]
) {
  const uniqueIds = Array.from(new Set(recordIds.filter(Boolean)));
  const results = [];

  for (const recordId of uniqueIds) {
    const record = await fetchRecord(supabase, recordId);
    const yesterday = await fetchBaseline(supabase, record, 1);
    const lastWeek = await fetchBaseline(supabase, record, 7);
    const target = await fetchLatestTarget(supabase, record);

    const deltas = Object.fromEntries(
      METRIC_KEYS.flatMap((key) => [
        [`${key}_dod`, round4(percentDelta(metricValue(record, key), metricValue(yesterday, key)))],
        [`${key}_wow`, round4(percentDelta(metricValue(record, key), metricValue(lastWeek, key)))],
      ])
    ) as Record<string, number | null>;

    const cpaDeviation = round4(percentDelta(metricValue(record, 'cpa'), toNumber(target?.target_cpa)));
    const day1Deviation = round4(percentDelta(metricValue(record, 'retention_day1'), toNumber(target?.target_retention_day1)));
    const day7Deviation = round4(percentDelta(metricValue(record, 'retention_day7'), toNumber(target?.target_retention_day7)));
    const isCostAlert = deltas.cost_dod != null && (deltas.cost_dod > 50 || deltas.cost_dod < -50);
    const isActivationsAlert = deltas.activations_dod != null && (deltas.activations_dod > 50 || deltas.activations_dod < -50);

    const isCpaAlert =
      (deltas.cpa_dod != null && deltas.cpa_dod >= 25) ||
      (deltas.cpa_wow != null && deltas.cpa_wow >= 15) ||
      (cpaDeviation != null && cpaDeviation >= 20);

    const isDay1Alert =
      (deltas.retention_day1_dod != null && deltas.retention_day1_dod <= -30) ||
      (deltas.retention_day1_wow != null && deltas.retention_day1_wow <= -15) ||
      (day1Deviation != null && day1Deviation <= -20);

    const isDay7Alert =
      (deltas.retention_day7_dod != null && deltas.retention_day7_dod <= -30) ||
      (deltas.retention_day7_wow != null && deltas.retention_day7_wow <= -15) ||
      (day7Deviation != null && day7Deviation <= -20);

    const summaries = [];
    if (isCostAlert) {
      summaries.push(`消耗异常：日环比 ${formatSignedPercent(deltas.cost_dod)}`);
    }
    if (isActivationsAlert) {
      summaries.push(`激活异常：日环比 ${formatSignedPercent(deltas.activations_dod)}`);
    }
    if (isCpaAlert) {
      summaries.push(`CPA异常：日环比 ${formatSignedPercent(deltas.cpa_dod)}，周同比 ${formatSignedPercent(deltas.cpa_wow)}，考核偏离 ${formatSignedPercent(cpaDeviation)}`);
    }
    if (isDay1Alert) {
      summaries.push(`次留异常：日环比 ${formatSignedPercent(deltas.retention_day1_dod)}，周同比 ${formatSignedPercent(deltas.retention_day1_wow)}，考核偏离 ${formatSignedPercent(day1Deviation)}`);
    }
    if (isDay7Alert) {
      summaries.push(`7留异常：日环比 ${formatSignedPercent(deltas.retention_day7_dod)}，周同比 ${formatSignedPercent(deltas.retention_day7_wow)}，考核偏离 ${formatSignedPercent(day7Deviation)}`);
    }

    const hasAlert = isCostAlert || isActivationsAlert || isCpaAlert || isDay1Alert || isDay7Alert;
    const existingStatus = await fetchExistingStatus(supabase, record.id);
    const status = hasAlert ? existingStatus : 'resolved';

    const payload = {
      daily_record_id: record.id,
      record_date: record.record_date,
      agent_id: record.agent_id,
      product_id: record.product_id,
      channel_id: record.channel_id,
      creative_type: record.creative_type,
      cost_dod: deltas.cost_dod,
      activations_dod: deltas.activations_dod,
      cpa_dod: deltas.cpa_dod,
      ctr_dod: deltas.ctr_dod,
      cvr_dod: deltas.cvr_dod,
      cpm_dod: deltas.cpm_dod,
      retention_day1_dod: deltas.retention_day1_dod,
      retention_day7_dod: deltas.retention_day7_dod,
      cost_wow: deltas.cost_wow,
      activations_wow: deltas.activations_wow,
      cpa_wow: deltas.cpa_wow,
      ctr_wow: deltas.ctr_wow,
      cvr_wow: deltas.cvr_wow,
      cpm_wow: deltas.cpm_wow,
      retention_day1_wow: deltas.retention_day1_wow,
      retention_day7_wow: deltas.retention_day7_wow,
      cpa_target_deviation: cpaDeviation,
      retention_day1_target_deviation: day1Deviation,
      retention_day7_target_deviation: day7Deviation,
      is_cost_alert: isCostAlert,
      is_activations_alert: isActivationsAlert,
      is_cpa_alert: isCpaAlert,
      is_retention_day1_alert: isDay1Alert,
      is_retention_day7_alert: isDay7Alert,
      has_alert: hasAlert,
      alert_summary: summaries.length > 0 ? summaries.join('；') : '无站内告警',
      status,
    };

    const { data, error } = await supabase
      .from('alert_results')
      .upsert(payload, { onConflict: 'daily_record_id' })
      .select()
      .single();

    if (error) throw error;
    results.push(data);
  }

  return results;
}

export async function recalculateAlertsForDate(
  supabase: SupabaseClient,
  recordDate: string,
  agentId?: string
) {
  let query = supabase
    .from('daily_records')
    .select('id')
    .eq('record_date', recordDate);

  if (agentId) {
    query = query.eq('agent_id', agentId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return recalculateAlertsForRecordIds(
    supabase,
    (data || []).map((row: { id: string }) => row.id)
  );
}
