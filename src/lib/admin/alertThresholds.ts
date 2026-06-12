export type AlertThresholdMetricKey =
  | 'cost_dod'
  | 'cost_wow'
  | 'activations_dod'
  | 'activations_wow'
  | 'cpa_target_deviation'
  | 'cpa_dod'
  | 'cpa_wow'
  | 'retention_day1_dod'
  | 'retention_day1_wow'
  | 'retention_day1_target_deviation'
  | 'retention_day7_dod'
  | 'retention_day7_wow'
  | 'retention_day7_target_deviation';

export type AlertThresholdMetricGroup = 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7';
export type AlertThresholdIssueType = 'dod' | 'wow' | 'target_deviation';

export interface AlertThresholdMetricDefinition {
  key: AlertThresholdMetricKey;
  label: string;
  group: AlertThresholdMetricGroup;
  issueType: AlertThresholdIssueType;
}

export interface AlertThresholdSettingLike {
  product_id: string;
  channel_id: string;
  creative_type: string;
  metric_key: AlertThresholdMetricKey | string;
  upper_threshold: number | string | null;
  lower_threshold: number | string | null;
}

export interface AlertThresholdValue {
  upper_threshold: number | null;
  lower_threshold: number | null;
}

export type AlertThresholdLookup = Map<string, AlertThresholdValue>;

export type AlertMetricIssueHits = Partial<Record<AlertThresholdIssueType, boolean>>;
export type AlertMetricIssueHitMap = Partial<Record<AlertThresholdMetricGroup, AlertMetricIssueHits>>;

export const ALERT_THRESHOLD_METRICS: AlertThresholdMetricDefinition[] = [
  { key: 'cost_dod', label: '消耗日环比', group: 'cost', issueType: 'dod' },
  { key: 'cost_wow', label: '消耗周同比', group: 'cost', issueType: 'wow' },
  { key: 'activations_dod', label: '激活数日环比', group: 'activations', issueType: 'dod' },
  { key: 'activations_wow', label: '激活周同比', group: 'activations', issueType: 'wow' },
  { key: 'cpa_target_deviation', label: 'CPA偏离考核', group: 'cpa', issueType: 'target_deviation' },
  { key: 'cpa_dod', label: 'CPA日环比', group: 'cpa', issueType: 'dod' },
  { key: 'cpa_wow', label: 'CPA周同比', group: 'cpa', issueType: 'wow' },
  { key: 'retention_day1_dod', label: '次留日环比', group: 'retention_day1', issueType: 'dod' },
  { key: 'retention_day1_wow', label: '次留周同比', group: 'retention_day1', issueType: 'wow' },
  { key: 'retention_day1_target_deviation', label: '次留偏离考核', group: 'retention_day1', issueType: 'target_deviation' },
  { key: 'retention_day7_dod', label: '七留日环比', group: 'retention_day7', issueType: 'dod' },
  { key: 'retention_day7_wow', label: '七留周同比', group: 'retention_day7', issueType: 'wow' },
  { key: 'retention_day7_target_deviation', label: '七留偏离考核', group: 'retention_day7', issueType: 'target_deviation' },
];

export const ALERT_THRESHOLD_METRIC_KEYS = ALERT_THRESHOLD_METRICS.map((metric) => metric.key);

export const DEFAULT_ALERT_THRESHOLDS: Record<AlertThresholdMetricKey, AlertThresholdValue> = {
  cost_dod: { upper_threshold: 50, lower_threshold: 50 },
  cost_wow: { upper_threshold: null, lower_threshold: null },
  activations_dod: { upper_threshold: 50, lower_threshold: 50 },
  activations_wow: { upper_threshold: null, lower_threshold: null },
  cpa_target_deviation: { upper_threshold: 20, lower_threshold: null },
  cpa_dod: { upper_threshold: 25, lower_threshold: null },
  cpa_wow: { upper_threshold: 15, lower_threshold: null },
  retention_day1_dod: { upper_threshold: null, lower_threshold: 30 },
  retention_day1_wow: { upper_threshold: null, lower_threshold: 15 },
  retention_day1_target_deviation: { upper_threshold: null, lower_threshold: 20 },
  retention_day7_dod: { upper_threshold: null, lower_threshold: 30 },
  retention_day7_wow: { upper_threshold: null, lower_threshold: 15 },
  retention_day7_target_deviation: { upper_threshold: null, lower_threshold: 20 },
};

export function isAlertThresholdMetricKey(value: unknown): value is AlertThresholdMetricKey {
  return typeof value === 'string' && ALERT_THRESHOLD_METRIC_KEYS.includes(value as AlertThresholdMetricKey);
}

export function thresholdLookupKey(
  productId: string,
  channelId: string,
  creativeType: string,
  metricKey: AlertThresholdMetricKey | string
) {
  return `${productId}\n${channelId}\n${creativeType}\n${metricKey}`;
}

export function comboLookupKey(productId: string, channelId: string, creativeType: string) {
  return `${productId}\n${channelId}\n${creativeType}`;
}

export function toThresholdNumber(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function normalizeThresholdValue(value: unknown) {
  const next = toThresholdNumber(value);
  if (next == null) return null;
  if (next < 0) {
    throw new Error('阈值必须大于等于 0');
  }
  return Number(next.toFixed(4));
}

export function buildThresholdLookup(settings: AlertThresholdSettingLike[] | null | undefined): AlertThresholdLookup {
  const lookup: AlertThresholdLookup = new Map();
  for (const setting of settings || []) {
    if (!isAlertThresholdMetricKey(setting.metric_key)) continue;
    lookup.set(
      thresholdLookupKey(setting.product_id, setting.channel_id, setting.creative_type, setting.metric_key),
      {
        upper_threshold: toThresholdNumber(setting.upper_threshold),
        lower_threshold: toThresholdNumber(setting.lower_threshold),
      }
    );
  }
  return lookup;
}

export function thresholdForMetric(
  lookup: AlertThresholdLookup,
  productId: string,
  channelId: string,
  creativeType: string,
  metricKey: AlertThresholdMetricKey
) {
  return lookup.get(thresholdLookupKey(productId, channelId, creativeType, metricKey)) ||
    DEFAULT_ALERT_THRESHOLDS[metricKey];
}

export function isThresholdEnabled(threshold: AlertThresholdValue) {
  return threshold.upper_threshold != null || threshold.lower_threshold != null;
}

export function isThresholdHit(value: number | null | undefined, threshold: AlertThresholdValue) {
  if (value == null || !isThresholdEnabled(threshold)) return false;
  if (threshold.upper_threshold != null && value >= threshold.upper_threshold) return true;
  if (threshold.lower_threshold != null && value <= -threshold.lower_threshold) return true;
  return false;
}

export function isMetricThresholdHit(
  lookup: AlertThresholdLookup,
  productId: string,
  channelId: string,
  creativeType: string,
  metricKey: AlertThresholdMetricKey,
  value: number | null | undefined
) {
  return isThresholdHit(value, thresholdForMetric(lookup, productId, channelId, creativeType, metricKey));
}

export function buildMetricIssueHitMap(
  lookup: AlertThresholdLookup,
  productId: string,
  channelId: string,
  creativeType: string,
  values: Partial<Record<AlertThresholdMetricKey, number | null>>
): AlertMetricIssueHitMap {
  const hits: AlertMetricIssueHitMap = {};
  for (const definition of ALERT_THRESHOLD_METRICS) {
    if (!isMetricThresholdHit(lookup, productId, channelId, creativeType, definition.key, values[definition.key])) continue;
    hits[definition.group] = {
      ...(hits[definition.group] || {}),
      [definition.issueType]: true,
    };
  }
  return hits;
}

export function hasMetricIssueHit(hitMap: AlertMetricIssueHitMap, group: AlertThresholdMetricGroup) {
  const hits = hitMap[group];
  return Boolean(hits?.dod || hits?.wow || hits?.target_deviation);
}

export function compactThresholdSummaryParts(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join('，');
}

export function isMissingAlertThresholdTableError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'PGRST205' ||
    Boolean(candidate?.message?.includes('alert_threshold_settings'));
}

export async function readOptionalAlertThresholdRows<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>
) {
  try {
    const { data, error } = await query;
    if (error) {
      if (isMissingAlertThresholdTableError(error)) return [];
      throw error;
    }
    return data || [];
  } catch (error) {
    if (isMissingAlertThresholdTableError(error)) return [];
    throw error;
  }
}
