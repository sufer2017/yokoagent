import dayjs from 'dayjs';

export type AlertMetricKey = 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7';

export interface MetricRecordLike {
  cost?: number | string | null;
  activations?: number | string | null;
  cpa?: number | string | null;
  retention_day1?: number | string | null;
  retention_day7?: number | string | null;
}

export interface TargetLike {
  target_cpa?: number | string | null;
  target_retention_day1?: number | string | null;
  target_retention_day7?: number | string | null;
  activation_cap?: number | string | null;
  is_running?: boolean | null;
}

export interface AlertLike {
  cost_dod?: number | string | null;
  activations_dod?: number | string | null;
  cpa_dod?: number | string | null;
  cpa_wow?: number | string | null;
  cpa_target_deviation?: number | string | null;
  retention_day1_dod?: number | string | null;
  retention_day1_wow?: number | string | null;
  retention_day1_target_deviation?: number | string | null;
  retention_day7_dod?: number | string | null;
  retention_day7_wow?: number | string | null;
  retention_day7_target_deviation?: number | string | null;
  is_cost_alert?: boolean | null;
  is_activations_alert?: boolean | null;
  is_cpa_alert?: boolean | null;
  is_retention_day1_alert?: boolean | null;
  is_retention_day7_alert?: boolean | null;
}

export interface MetricDetail {
  key: AlertMetricKey;
  name: string;
  unit: 'number' | 'percent';
  actualValue: number | null;
  targetValue: number | null;
  dod: number | null;
  wow: number | null;
  targetDeviation: number | null;
  hit: boolean;
  redlineHit: boolean;
  redlineLabel: string;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function metricValue(record: MetricRecordLike | null | undefined, key: AlertMetricKey): number | null {
  if (!record) return null;
  if (key === 'cost') return toNumberOrNull(record.cost);
  if (key === 'activations') return toNumberOrNull(record.activations);
  if (key === 'cpa') {
    const cpa = toNumberOrNull(record.cpa);
    if (cpa != null) return cpa;
    const cost = toNumberOrNull(record.cost);
    const activations = toNumberOrNull(record.activations);
    return cost != null && activations != null && activations > 0 ? cost / activations : null;
  }
  return toNumberOrNull(record[key]);
}

export function percentDelta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

export function round2(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(2));
}

export function round4(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(4));
}

export function targetValue(target: TargetLike | null | undefined, key: AlertMetricKey): number | null {
  if (!target) return null;
  if (key === 'cost' || key === 'activations') return null;
  if (key === 'cpa') return toNumberOrNull(target.target_cpa);
  if (key === 'retention_day1') return toNumberOrNull(target.target_retention_day1);
  return toNumberOrNull(target.target_retention_day7);
}

export function isMetricRedline(record: MetricRecordLike, target: TargetLike | null | undefined, key: AlertMetricKey) {
  const actual = metricValue(record, key);
  const targetMetric = targetValue(target, key);
  if (key === 'cost' || key === 'activations') return false;
  if (actual == null || targetMetric == null) return false;
  return key === 'cpa' ? actual > targetMetric : actual < targetMetric;
}

export function buildRedlineFlags(record: MetricRecordLike, target: TargetLike | null | undefined) {
  const cpa = isMetricRedline(record, target, 'cpa');
  const retentionDay1 = isMetricRedline(record, target, 'retention_day1');
  const retentionDay7 = isMetricRedline(record, target, 'retention_day7');
  return {
    cpa,
    retention_day1: retentionDay1,
    retention_day7: retentionDay7,
    count: [cpa, retentionDay1, retentionDay7].filter(Boolean).length,
    has_redline: cpa || retentionDay1 || retentionDay7,
  };
}

export function buildMetricDetails(
  alert: AlertLike,
  record: MetricRecordLike | null | undefined,
  target: TargetLike | null | undefined
): MetricDetail[] {
  return [
    {
      key: 'cost',
      name: '消耗',
      unit: 'number',
      actualValue: metricValue(record, 'cost'),
      targetValue: null,
      dod: toNumberOrNull(alert.cost_dod),
      wow: null,
      targetDeviation: null,
      hit: Boolean(alert.is_cost_alert),
      redlineHit: Boolean(alert.is_cost_alert),
      redlineLabel: '日环比波动超过50%',
    },
    {
      key: 'activations',
      name: '激活',
      unit: 'number',
      actualValue: metricValue(record, 'activations'),
      targetValue: null,
      dod: toNumberOrNull(alert.activations_dod),
      wow: null,
      targetDeviation: null,
      hit: Boolean(alert.is_activations_alert),
      redlineHit: Boolean(alert.is_activations_alert),
      redlineLabel: '日环比波动超过50%',
    },
    {
      key: 'cpa',
      name: 'CPA',
      unit: 'number',
      actualValue: metricValue(record, 'cpa'),
      targetValue: targetValue(target, 'cpa'),
      dod: toNumberOrNull(alert.cpa_dod),
      wow: toNumberOrNull(alert.cpa_wow),
      targetDeviation: toNumberOrNull(alert.cpa_target_deviation),
      hit: Boolean(alert.is_cpa_alert),
      redlineHit: record ? isMetricRedline(record, target, 'cpa') : false,
      redlineLabel: '高于考核 CPA',
    },
    {
      key: 'retention_day1',
      name: '次留',
      unit: 'percent',
      actualValue: metricValue(record, 'retention_day1'),
      targetValue: targetValue(target, 'retention_day1'),
      dod: toNumberOrNull(alert.retention_day1_dod),
      wow: toNumberOrNull(alert.retention_day1_wow),
      targetDeviation: toNumberOrNull(alert.retention_day1_target_deviation),
      hit: Boolean(alert.is_retention_day1_alert),
      redlineHit: record ? isMetricRedline(record, target, 'retention_day1') : false,
      redlineLabel: '低于考核次留',
    },
    {
      key: 'retention_day7',
      name: '7留',
      unit: 'percent',
      actualValue: metricValue(record, 'retention_day7'),
      targetValue: targetValue(target, 'retention_day7'),
      dod: toNumberOrNull(alert.retention_day7_dod),
      wow: toNumberOrNull(alert.retention_day7_wow),
      targetDeviation: toNumberOrNull(alert.retention_day7_target_deviation),
      hit: Boolean(alert.is_retention_day7_alert),
      redlineHit: record ? isMetricRedline(record, target, 'retention_day7') : false,
      redlineLabel: '低于考核7留',
    },
  ];
}

export function weightedAverage(
  rows: Array<MetricRecordLike>,
  key: 'retention_day1' | 'retention_day7'
) {
  const weighted = rows
    .map((row) => ({
      value: metricValue(row, key),
      weight: toNumberOrNull(row.activations) || 0,
    }))
    .filter((row) => row.value != null && row.weight > 0);
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight > 0) {
    return weighted.reduce((sum, row) => sum + (row.value || 0) * row.weight, 0) / totalWeight;
  }

  const values = rows.map((row) => metricValue(row, key)).filter((value): value is number => value != null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function beijingDeadlineIso(recordDate: string) {
  const deadlineDate = dayjs(recordDate).add(1, 'day').format('YYYY-MM-DD');
  return `${deadlineDate}T04:00:00.000Z`;
}

export function beijingDeadlineLabel(recordDate: string) {
  return `${dayjs(recordDate).add(1, 'day').format('YYYY-MM-DD')} 12:00`;
}

export function isLateFill(recordDate: string, firstFilledAt: string | null, now = new Date()) {
  const deadline = new Date(beijingDeadlineIso(recordDate));
  if (!firstFilledAt) return now.getTime() > deadline.getTime();
  return new Date(firstFilledAt).getTime() > deadline.getTime();
}

export function listDates(endDate: string, days: number) {
  return Array.from({ length: days }, (_, index) => (
    dayjs(endDate).subtract(days - index - 1, 'day').format('YYYY-MM-DD')
  ));
}
