import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import {
  ALERT_THRESHOLD_METRICS,
  comboLookupKey,
  DEFAULT_ALERT_THRESHOLDS,
  isMissingAlertThresholdTableError,
  normalizeThresholdValue,
  readOptionalAlertThresholdRows,
  type AlertThresholdMetricKey,
  type AlertThresholdSettingLike,
} from '@/lib/admin/alertThresholds';
import {
  mutateLocalDb,
  newId,
  nowIso,
  readLocalDb,
  recalculateLocalAlertsForRecordIds,
  type LocalAlertThresholdSetting,
  type LocalDb,
} from '@/lib/local-db/store';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';

interface ScopeCombo {
  product_id: string;
  product_name: string;
  channel_id: string;
  channel_name: string;
  creative_type: string;
}

interface ThresholdPatchCell {
  upper_threshold?: unknown;
  lower_threshold?: unknown;
}

interface ThresholdPatchBody {
  product_id?: unknown;
  channel_id?: unknown;
  creative_type?: unknown;
  thresholds?: Partial<Record<AlertThresholdMetricKey, ThresholdPatchCell>>;
}

async function requireAdminSession() {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }
  if (session.role !== 'admin') {
    return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

function emptyThresholds() {
  return Object.fromEntries(ALERT_THRESHOLD_METRICS.map((metric) => [
    metric.key,
    { ...DEFAULT_ALERT_THRESHOLDS[metric.key] },
  ])) as Record<AlertThresholdMetricKey, { upper_threshold: number | null; lower_threshold: number | null }>;
}

function sortCombos(left: ScopeCombo, right: ScopeCombo) {
  return (
    left.product_name.localeCompare(right.product_name, 'zh-Hans-CN') ||
    left.channel_name.localeCompare(right.channel_name, 'zh-Hans-CN') ||
    left.creative_type.localeCompare(right.creative_type, 'zh-Hans-CN')
  );
}

function buildResponse(combos: ScopeCombo[], settings: AlertThresholdSettingLike[]) {
  const settingByKey = new Map(settings.map((setting) => [
    `${comboLookupKey(setting.product_id, setting.channel_id, setting.creative_type)}\n${setting.metric_key}`,
    setting,
  ]));
  const sortedCombos = combos.sort(sortCombos);
  return {
    metrics: ALERT_THRESHOLD_METRICS.map((metric) => ({ key: metric.key, label: metric.label })),
    filters: {
      products: Array.from(new Map(sortedCombos.map((combo) => [
        combo.product_id,
        { id: combo.product_id, name: combo.product_name },
      ])).values()),
      channels: Array.from(new Map(sortedCombos.map((combo) => [
        combo.channel_id,
        { id: combo.channel_id, name: combo.channel_name },
      ])).values()),
      creativeTypes: Array.from(new Set(sortedCombos.map((combo) => combo.creative_type)))
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
        .map((name) => ({ name })),
    },
    rows: sortedCombos.map((combo) => {
      const thresholds = emptyThresholds();
      for (const metric of ALERT_THRESHOLD_METRICS) {
        const setting = settingByKey.get(`${comboLookupKey(combo.product_id, combo.channel_id, combo.creative_type)}\n${metric.key}`);
        if (!setting) continue;
        thresholds[metric.key] = {
          upper_threshold: setting.upper_threshold == null ? null : Number(setting.upper_threshold),
          lower_threshold: setting.lower_threshold == null ? null : Number(setting.lower_threshold),
        };
      }
      return {
        id: comboLookupKey(combo.product_id, combo.channel_id, combo.creative_type),
        ...combo,
        thresholds,
      };
    }),
  };
}

function addLocalCombo(db: LocalDb, combos: Map<string, ScopeCombo>, productId: string, channelId: string, creativeType: string) {
  const product = db.products.find((item) => item.id === productId);
  const channel = db.channels.find((item) => item.id === channelId);
  if (!product || !channel || !creativeType) return;
  combos.set(comboLookupKey(productId, channelId, creativeType), {
    product_id: productId,
    product_name: product.name,
    channel_id: channelId,
    channel_name: channel.name,
    creative_type: creativeType,
  });
}

function localCombos(db: LocalDb) {
  const combos = new Map<string, ScopeCombo>();
  for (const scope of db.agent_authorized_scopes.filter((item) => item.is_active)) {
    const agent = db.agents.find((item) => item.id === scope.agent_id && item.is_active);
    if (!agent) continue;
    addLocalCombo(db, combos, agent.product_id, agent.channel_id, scope.creative_type);
  }
  for (const target of db.target_changes) {
    addLocalCombo(db, combos, target.product_id, target.channel_id, target.creative_type);
  }
  for (const record of db.daily_records) {
    addLocalCombo(db, combos, record.product_id, record.channel_id, record.creative_type);
  }
  return Array.from(combos.values());
}

async function supabaseCombos() {
  const supabase = createServerSupabase();
  const [
    productsRes,
    channelsRes,
    agentsRes,
    scopesRes,
    targetsRes,
    recordsRes,
  ] = await Promise.all([
    supabase.from('products').select('id, name').order('name'),
    supabase.from('channels').select('id, name').order('name'),
    supabase.from('agents').select('id, product_id, channel_id, is_active'),
    supabase.from('agent_authorized_scopes').select('agent_id, creative_type, is_active'),
    supabase.from('target_changes').select('product_id, channel_id, creative_type').limit(10000),
    supabase.from('daily_records').select('product_id, channel_id, creative_type').limit(10000),
  ]);

  for (const result of [productsRes, channelsRes, agentsRes, scopesRes, targetsRes, recordsRes]) {
    if (result.error) throw result.error;
  }
  const thresholdRows = await readOptionalAlertThresholdRows<AlertThresholdSettingLike>(
    supabase.from('alert_threshold_settings').select('product_id, channel_id, creative_type, metric_key, upper_threshold, lower_threshold')
  );

  const products = new Map((productsRes.data || []).map((item: { id: string; name: string }) => [item.id, item.name]));
  const channels = new Map((channelsRes.data || []).map((item: { id: string; name: string }) => [item.id, item.name]));
  const agents = new Map((agentsRes.data || []).map((item: { id: string; product_id: string; channel_id: string; is_active: boolean }) => [item.id, item]));
  const combos = new Map<string, ScopeCombo>();
  const addCombo = (productId: string, channelId: string, creativeType: string) => {
    const productName = products.get(productId);
    const channelName = channels.get(channelId);
    if (!productName || !channelName || !creativeType) return;
    combos.set(comboLookupKey(productId, channelId, creativeType), {
      product_id: productId,
      product_name: productName,
      channel_id: channelId,
      channel_name: channelName,
      creative_type: creativeType,
    });
  };

  for (const scope of scopesRes.data || []) {
    const item = scope as { agent_id: string; creative_type: string; is_active: boolean };
    if (!item.is_active) continue;
    const agent = agents.get(item.agent_id);
    if (!agent?.is_active) continue;
    addCombo(agent.product_id, agent.channel_id, item.creative_type);
  }
  for (const target of targetsRes.data || []) {
    const item = target as { product_id: string; channel_id: string; creative_type: string };
    addCombo(item.product_id, item.channel_id, item.creative_type);
  }
  for (const record of recordsRes.data || []) {
    const item = record as { product_id: string; channel_id: string; creative_type: string };
    addCombo(item.product_id, item.channel_id, item.creative_type);
  }

  return {
    combos: Array.from(combos.values()),
    settings: thresholdRows,
  };
}

function validatePatchBody(body: ThresholdPatchBody) {
  const productId = typeof body.product_id === 'string' ? body.product_id : '';
  const channelId = typeof body.channel_id === 'string' ? body.channel_id : '';
  const creativeType = typeof body.creative_type === 'string' ? body.creative_type.trim() : '';
  if (!productId || !channelId || !creativeType || !body.thresholds || typeof body.thresholds !== 'object') {
    throw new Error('阈值配置参数不完整');
  }

  return ALERT_THRESHOLD_METRICS.map((metric) => {
    const rawCell = body.thresholds?.[metric.key];
    const cell: ThresholdPatchCell = rawCell && typeof rawCell === 'object' ? rawCell : {};
    return {
      product_id: productId,
      channel_id: channelId,
      creative_type: creativeType,
      metric_key: metric.key,
      upper_threshold: normalizeThresholdValue(cell.upper_threshold),
      lower_threshold: normalizeThresholdValue(cell.lower_threshold),
    };
  });
}

export async function GET() {
  try {
    const auth = await requireAdminSession();
    if ('response' in auth) return auth.response;

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      return NextResponse.json({
        success: true,
        data: buildResponse(localCombos(db), db.alert_threshold_settings),
      });
    }

    const { combos, settings } = await supabaseCombos();
    return NextResponse.json({ success: true, data: buildResponse(combos, settings) });
  } catch (error) {
    console.error('GET /api/alert-thresholds error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch alert thresholds' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdminSession();
    if ('response' in auth) return auth.response;

    const settings = validatePatchBody(await request.json());
    const first = settings[0];

    if (!hasSupabaseConfig()) {
      await mutateLocalDb((db) => {
        const timestamp = nowIso();
        for (const setting of settings) {
          const existing = db.alert_threshold_settings.find((item) => (
            item.product_id === setting.product_id &&
            item.channel_id === setting.channel_id &&
            item.creative_type === setting.creative_type &&
            item.metric_key === setting.metric_key
          ));
          const next: LocalAlertThresholdSetting = {
            id: existing?.id || newId(),
            ...setting,
            created_at: existing?.created_at || timestamp,
            updated_at: timestamp,
          };
          if (existing) {
            Object.assign(existing, next);
          } else {
            db.alert_threshold_settings.push(next);
          }
        }
        const recordIds = db.daily_records
          .filter((record) => (
            record.product_id === first.product_id &&
            record.channel_id === first.channel_id &&
            record.creative_type === first.creative_type
          ))
          .map((record) => record.id);
        recalculateLocalAlertsForRecordIds(db, recordIds);
      });
      const db = await readLocalDb();
      return NextResponse.json({
        success: true,
        data: buildResponse(localCombos(db), db.alert_threshold_settings),
      });
    }

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('alert_threshold_settings')
      .upsert(settings, { onConflict: 'product_id,channel_id,creative_type,metric_key' });
    if (error && isMissingAlertThresholdTableError(error)) {
      return NextResponse.json({ success: false, error: '请先执行 alert_threshold_settings 数据库 migration' }, { status: 409 });
    }
    if (error) throw error;

    const { data: records, error: recordsError } = await supabase
      .from('daily_records')
      .select('id')
      .eq('product_id', first.product_id)
      .eq('channel_id', first.channel_id)
      .eq('creative_type', first.creative_type);
    if (recordsError) throw recordsError;

    await recalculateAlertsForRecordIds(supabase, (records || []).map((record: { id: string }) => record.id));

    const { combos, settings: nextSettings } = await supabaseCombos();
    return NextResponse.json({ success: true, data: buildResponse(combos, nextSettings) });
  } catch (error) {
    console.error('PATCH /api/alert-thresholds error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to save alert thresholds' }, { status: 500 });
  }
}
