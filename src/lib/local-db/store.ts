import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import type { AlertStatus } from '@/types/database';
import { addDateDays, defaultBusinessAnchorDate } from '@/lib/admin/dates';
import { buildMetricDetails } from '@/lib/admin/metrics';
import { DEMO_AGENT_CREDENTIALS } from '@/lib/admin/passwords';
import { normalizeCreativeTypes } from '@/lib/admin/creativeTypes';
import demoLocalDbSeed from '../../../sample_data/demo-local-db.json';

const DB_PATH = process.env.YOKOAGENT_LOCAL_DB_PATH
  || (process.env.VERCEL
    ? path.join('/tmp', 'yokoagent-local-db.json')
    : path.join(process.cwd(), '.yokoagent-local-db.json'));

const SHOULD_USE_BUNDLED_DEMO_SEED = Boolean(process.env.VERCEL)
  || process.env.YOKOAGENT_USE_BUNDLED_DEMO_SEED === 'true';

export interface LocalChannel {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalProduct {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalAgent {
  id: string;
  product_id: string;
  channel_id: string;
  name: string;
  username: string;
  creative_types: string[];
  feishu_webhook?: string | null;
  password_hash: string;
  password_plaintext?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalDailyRecord {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  creative_type: string;
  cost: number;
  activations: number;
  cpa: number | null;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalTargetChange {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  is_running: boolean;
  effective_date: string;
  target_cpa: number | null;
  target_retention_day1: number | null;
  target_retention_day7: number | null;
  activation_cap: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalAlertResult {
  id: string;
  daily_record_id: string;
  record_date: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  creative_type: string;
  cost_dod: number | null;
  activations_dod: number | null;
  cpa_dod: number | null;
  ctr_dod: number | null;
  cvr_dod: number | null;
  cpm_dod: number | null;
  retention_day1_dod: number | null;
  retention_day7_dod: number | null;
  cost_wow: number | null;
  activations_wow: number | null;
  cpa_wow: number | null;
  ctr_wow: number | null;
  cvr_wow: number | null;
  cpm_wow: number | null;
  retention_day1_wow: number | null;
  retention_day7_wow: number | null;
  cpa_target_deviation: number | null;
  retention_day1_target_deviation: number | null;
  retention_day7_target_deviation: number | null;
  is_cost_alert: boolean;
  is_activations_alert: boolean;
  is_cpa_alert: boolean;
  is_retention_day1_alert: boolean;
  is_retention_day7_alert: boolean;
  has_alert: boolean;
  alert_summary: string;
  status: AlertStatus;
  created_at: string;
  updated_at: string;
}

export interface LocalAlertIssueStatus {
  id: string;
  alert_result_id: string;
  issue_key: string;
  status: AlertStatus;
  created_at: string;
  updated_at: string;
}

export interface LocalDb {
  products: LocalProduct[];
  channels: LocalChannel[];
  agents: LocalAgent[];
  daily_records: LocalDailyRecord[];
  target_changes: LocalTargetChange[];
  alert_results: LocalAlertResult[];
  alert_issue_statuses: LocalAlertIssueStatus[];
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

const DEFAULT_PRODUCT_ID = 'local-product-default';
const DEFAULT_PRODUCT_NAME = '默认产品';

function emptyDb(): LocalDb {
  return {
    products: [],
    channels: [],
    agents: [],
    daily_records: [],
    target_changes: [],
    alert_results: [],
    alert_issue_statuses: [],
  };
}

function normalizeDb(candidate: Partial<LocalDb>): LocalDb {
  const db = { ...emptyDb(), ...candidate } as LocalDb;
  const timestamp = nowIso();
  if (!db.products || db.products.length === 0) {
    db.products = [{
      id: DEFAULT_PRODUCT_ID,
      name: DEFAULT_PRODUCT_NAME,
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp,
    }];
  }
  const defaultProductId = db.products[0]?.id || DEFAULT_PRODUCT_ID;
  const demoPasswordByUsername = new Map<string, string>(DEMO_AGENT_CREDENTIALS.map((item) => [item.username, item.password]));
  const creativeTypesByAgentId = new Map<string, string[]>();
  const pushCreativeType = (agentId: string | undefined, creativeType: string | undefined) => {
    if (!agentId || !creativeType?.trim()) return;
    creativeTypesByAgentId.set(agentId, normalizeCreativeTypes([
      ...(creativeTypesByAgentId.get(agentId) || []),
      creativeType,
    ]));
  };
  for (const target of db.target_changes || []) pushCreativeType(target.agent_id, target.creative_type);
  for (const record of db.daily_records || []) pushCreativeType(record.agent_id, record.creative_type);
  db.agents = (db.agents || []).map((agent) => ({
    ...agent,
    product_id: agent.product_id || defaultProductId,
    creative_types: normalizeCreativeTypes([
      ...normalizeCreativeTypes(agent.creative_types),
      ...(creativeTypesByAgentId.get(agent.id) || []),
    ]),
    password_plaintext: agent.password_plaintext || demoPasswordByUsername.get(agent.username) || '',
  }));
  db.daily_records = (db.daily_records || []).map((record) => {
    const agent = db.agents.find((item) => item.id === record.agent_id);
    const productId = record.product_id || agent?.product_id || defaultProductId;
    const activations = Number(record.activations || 0);
    const cost = Number(record.cost || 0);
    return {
      ...record,
      product_id: productId,
      cpa: activations > 0 ? Number((cost / activations).toFixed(2)) : null,
    };
  });
  db.target_changes = (db.target_changes || []).map((target) => {
    const agent = db.agents.find((item) => item.id === target.agent_id);
    return {
      ...target,
      product_id: target.product_id || agent?.product_id || defaultProductId,
      creative_type: target.creative_type || '',
      activation_cap: target.activation_cap ?? null,
    };
  });
  db.alert_results = (db.alert_results || []).map((alert) => {
    const record = db.daily_records.find((item) => item.id === alert.daily_record_id);
    const agent = db.agents.find((item) => item.id === alert.agent_id);
    return {
      ...alert,
      product_id: alert.product_id || record?.product_id || agent?.product_id || defaultProductId,
      is_cost_alert: Boolean(alert.is_cost_alert),
      is_activations_alert: Boolean(alert.is_activations_alert),
    };
  });
  const alertIds = new Set(db.alert_results.map((alert) => alert.id));
  db.alert_issue_statuses = (db.alert_issue_statuses || [])
    .filter((item) => alertIds.has(item.alert_result_id))
    .map((item) => ({
      ...item,
      status: item.status === 'acknowledged' || item.status === 'resolved' ? item.status : 'open',
    }));
  return db;
}

function cloneDb(db: LocalDb): LocalDb {
  return JSON.parse(JSON.stringify(db)) as LocalDb;
}

function bundledDemoDb(): LocalDb {
  return cloneDb(normalizeDb(demoLocalDbSeed as unknown as Partial<LocalDb>));
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

export async function readLocalDb(): Promise<LocalDb> {
  try {
    const text = await fs.readFile(DB_PATH, 'utf8');
    return normalizeDb(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (SHOULD_USE_BUNDLED_DEMO_SEED) {
        return bundledDemoDb();
      }
      return emptyDb();
    }
    throw error;
  }
}

export async function writeLocalDb(db: LocalDb) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

export async function mutateLocalDb<T>(mutator: (db: LocalDb) => T | Promise<T>) {
  const db = await readLocalDb();
  const result = await mutator(db);
  pruneOldBusinessData(db);
  await writeLocalDb(db);
  return result;
}

export function channelName(db: LocalDb, channelId: string) {
  return db.channels.find((channel) => channel.id === channelId)?.name || '';
}

export function productName(db: LocalDb, productId: string) {
  return db.products.find((product) => product.id === productId)?.name || '';
}

export function agentName(db: LocalDb, agentId: string) {
  return db.agents.find((agent) => agent.id === agentId)?.name || '';
}

export function agentFeishuWebhook(db: LocalDb, agentId: string) {
  return db.agents.find((agent) => agent.id === agentId)?.feishu_webhook || '';
}

export function decorateAgent(db: LocalDb, agent: LocalAgent) {
  return {
    ...agent,
    creative_types: normalizeCreativeTypes(agent.creative_types),
    feishu_webhook: agent.feishu_webhook || '',
    password_plaintext: agent.password_plaintext || '',
    password_hash: undefined,
    product_name: productName(db, agent.product_id),
    channel_name: channelName(db, agent.channel_id),
  };
}

export function decorateTarget(db: LocalDb, target: LocalTargetChange) {
  return {
    ...target,
    agent_name: agentName(db, target.agent_id),
    product_name: productName(db, target.product_id),
    channel_name: channelName(db, target.channel_id),
  };
}

export function decorateAlert(db: LocalDb, alert: LocalAlertResult) {
  const record = db.daily_records.find((item) => item.id === alert.daily_record_id);
  const target = record ? latestTargetForRecord(db, record.agent_id, record.channel_id, record.record_date, record.product_id, record.creative_type) : null;
  const metricDetails = buildMetricDetails(alert, record, target);
  return {
    ...alert,
    agent_name: agentName(db, alert.agent_id),
    product_name: productName(db, alert.product_id),
    feishu_webhook: agentFeishuWebhook(db, alert.agent_id),
    channel_name: channelName(db, alert.channel_id),
    target_cpa: target?.target_cpa ?? null,
    target_retention_day1: target?.target_retention_day1 ?? null,
    target_retention_day7: target?.target_retention_day7 ?? null,
    activation_cap: target?.activation_cap ?? null,
    metricDetails,
    record: record ? {
      cost: record.cost,
      activations: record.activations,
      cpa: record.cpa,
      ctr: record.ctr,
      cvr: record.cvr,
      cpm: record.cpm,
      retention_day1: record.retention_day1,
      retention_day7: record.retention_day7,
    } : null,
  };
}

export function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function cpaCheckDelta(cost: unknown, activations: unknown, cpa: unknown) {
  const costValue = toNumberOrNull(cost);
  const activationsValue = toNumberOrNull(activations);
  const cpaValue = toNumberOrNull(cpa);
  if (costValue == null || !activationsValue || cpaValue == null) return null;
  const computed = costValue / activationsValue;
  if (computed === 0) return null;
  return Number((((cpaValue - computed) / computed) * 100).toFixed(2));
}

export function computedCpa(cost: unknown, activations: unknown) {
  const costValue = toNumberOrNull(cost);
  const activationsValue = toNumberOrNull(activations);
  if (costValue == null || activationsValue == null || activationsValue <= 0) return null;
  return Number((costValue / activationsValue).toFixed(2));
}

export function latestTargetForRecord(
  db: LocalDb,
  agentId: string,
  channelId: string,
  recordDate: string,
  productId?: string,
  creativeType?: string
) {
  const agent = db.agents.find((item) => item.id === agentId);
  const effectiveProductId = productId || agent?.product_id || db.products[0]?.id;
  return db.target_changes
    .filter((target) => (
      target.agent_id === agentId &&
      (!effectiveProductId || target.product_id === effectiveProductId) &&
      target.channel_id === channelId &&
      (!target.creative_type || !creativeType || target.creative_type === creativeType) &&
      target.effective_date <= recordDate
    ))
    .sort((left, right) => (
      right.effective_date.localeCompare(left.effective_date) ||
      Number(Boolean(right.creative_type)) - Number(Boolean(left.creative_type))
    ))[0] || null;
}

export function decorateRecord(db: LocalDb, record: LocalDailyRecord) {
  const target = latestTargetForRecord(db, record.agent_id, record.channel_id, record.record_date, record.product_id, record.creative_type);
  return {
    ...record,
    cpa: computedCpa(record.cost, record.activations),
    agent_name: agentName(db, record.agent_id),
    product_name: productName(db, record.product_id),
    channel_name: channelName(db, record.channel_id),
    target_cpa: target?.target_cpa ?? null,
    target_retention_day1: target?.target_retention_day1 ?? null,
    target_retention_day7: target?.target_retention_day7 ?? null,
    activation_cap: target?.activation_cap ?? null,
    is_running: target?.is_running ?? null,
    cpa_check_delta: null,
  };
}

function metricValue(record: LocalDailyRecord | null, key: MetricKey) {
  if (!record) return null;
  if (key === 'cpa' && record.cpa == null) {
    return record.activations > 0 ? record.cost / record.activations : null;
  }
  return toNumberOrNull(record[key]);
}

function percentDelta(current: number | null, baseline: number | null) {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function round4(value: number | null) {
  return value == null ? null : Number(value.toFixed(4));
}

function formatSignedPercent(value: number | null) {
  if (value == null) return '无基线';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function baselineFor(db: LocalDb, record: LocalDailyRecord, days: number) {
  const targetDate = dayjs(record.record_date).subtract(days, 'day').format('YYYY-MM-DD');
  return db.daily_records.find((item) => (
    item.agent_id === record.agent_id &&
    item.product_id === record.product_id &&
    item.channel_id === record.channel_id &&
    item.creative_type === record.creative_type &&
    item.record_date === targetDate
  )) || null;
}

export function recalculateLocalAlertsForRecordIds(db: LocalDb, recordIds: string[]) {
  const updated: LocalAlertResult[] = [];
  const uniqueIds = Array.from(new Set(recordIds.filter(Boolean)));

  for (const recordId of uniqueIds) {
    const record = db.daily_records.find((item) => item.id === recordId);
    if (!record) continue;

    const yesterday = baselineFor(db, record, 1);
    const lastWeek = baselineFor(db, record, 7);
    record.cpa = computedCpa(record.cost, record.activations);
    const target = latestTargetForRecord(db, record.agent_id, record.channel_id, record.record_date, record.product_id, record.creative_type);

    const deltas = Object.fromEntries(
      METRIC_KEYS.flatMap((key) => [
        [`${key}_dod`, round4(percentDelta(metricValue(record, key), metricValue(yesterday, key)))],
        [`${key}_wow`, round4(percentDelta(metricValue(record, key), metricValue(lastWeek, key)))],
      ])
    ) as Record<string, number | null>;

    const cpaDeviation = round4(percentDelta(metricValue(record, 'cpa'), target?.target_cpa ?? null));
    const day1Deviation = round4(percentDelta(metricValue(record, 'retention_day1'), target?.target_retention_day1 ?? null));
    const day7Deviation = round4(percentDelta(metricValue(record, 'retention_day7'), target?.target_retention_day7 ?? null));
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
    const existing = db.alert_results.find((alert) => alert.daily_record_id === record.id);
    const timestamp = nowIso();
    const next: LocalAlertResult = {
      id: existing?.id || newId(),
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
      status: hasAlert ? (existing?.status === 'acknowledged' || existing?.status === 'resolved' ? existing.status : 'open') : 'resolved',
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      db.alert_results.push(next);
    }
    updated.push(next);
  }

  return updated;
}

export function cascadeDeleteRecords(db: LocalDb, predicate: (record: LocalDailyRecord) => boolean) {
  const deletedRecordIds = new Set(db.daily_records.filter(predicate).map((record) => record.id));
  const deletedAlertIds = new Set(db.alert_results
    .filter((alert) => deletedRecordIds.has(alert.daily_record_id))
    .map((alert) => alert.id));
  db.daily_records = db.daily_records.filter((record) => !deletedRecordIds.has(record.id));
  db.alert_results = db.alert_results.filter((alert) => !deletedRecordIds.has(alert.daily_record_id));
  db.alert_issue_statuses = db.alert_issue_statuses.filter((item) => !deletedAlertIds.has(item.alert_result_id));
}

export function cascadeDeleteAgents(db: LocalDb, agentIds: string[]) {
  const ids = new Set(agentIds);
  cascadeDeleteRecords(db, (record) => ids.has(record.agent_id));
  db.target_changes = db.target_changes.filter((target) => !ids.has(target.agent_id));
  const deletedAlertIds = new Set(db.alert_results.filter((alert) => ids.has(alert.agent_id)).map((alert) => alert.id));
  db.alert_results = db.alert_results.filter((alert) => !ids.has(alert.agent_id));
  db.alert_issue_statuses = db.alert_issue_statuses.filter((item) => !deletedAlertIds.has(item.alert_result_id));
  db.agents = db.agents.filter((agent) => !ids.has(agent.id));
}

export function pruneOldBusinessData(db: LocalDb, anchorDate = defaultBusinessAnchorDate()) {
  const cutoff = addDateDays(anchorDate, -20);
  cascadeDeleteRecords(db, (record) => record.record_date < cutoff);
  const deletedAlertIds = new Set(db.alert_results.filter((alert) => alert.record_date < cutoff).map((alert) => alert.id));
  db.alert_results = db.alert_results.filter((alert) => alert.record_date >= cutoff);
  db.alert_issue_statuses = db.alert_issue_statuses.filter((item) => !deletedAlertIds.has(item.alert_result_id));
  return { cutoff };
}
