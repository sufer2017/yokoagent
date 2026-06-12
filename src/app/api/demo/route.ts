import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { DEMO_AGENT_CREDENTIALS } from '@/lib/admin/passwords';
import { DEFAULT_PROMOTION_GOAL } from '@/lib/admin/creativeTypes';
import { upsertSupabaseDictionaries } from '@/lib/admin/scopes';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import {
  cascadeDeleteAgents,
  cascadeDeleteRecords,
  mutateLocalDb,
  newId,
  nowIso,
  recalculateLocalAlertsForRecordIds,
  replaceLocalAgentScopes,
  type LocalDb,
} from '@/lib/local-db/store';

const DEMO_CREATED_BY = 'demo_seed';
const DEMO_NAME_PREFIX = '演示-';
const LEGACY_DEMO_NAMES = new Set(['A代理', 'B代理', 'C代理']);

const DEMO_CHANNELS = [
  { key: 'gdt', name: '广点通' },
  { key: 'douyin', name: '抖音' },
  { key: 'kuaishou', name: '快手' },
  { key: 'xhs', name: '小红书' },
] as const;

const DEMO_PRODUCTS = [
  { key: 'game-a', name: '演示产品A' },
  { key: 'game-b', name: '演示产品B' },
] as const;

const DEMO_AGENTS = [
  { key: 'gdt-a', username: 'gdt-a', name: '演示-广点通A代理', productKey: 'game-a', channelKey: 'gdt', feishuWebhook: 'demo-feishu-webhook://gdt-a', baseCpa: 88, day1: 38, day7: 15, baseActivations: 96, creatives: ['短剧', '单本'] },
  { key: 'gdt-b', username: 'gdt-b', name: '演示-广点通B代理', productKey: 'game-a', channelKey: 'gdt', feishuWebhook: 'demo-feishu-webhook://gdt-b', baseCpa: 94, day1: 36, day7: 14, baseActivations: 82, creatives: ['短剧', '影游'] },
  { key: 'douyin-a', username: 'douyin-a', name: '演示-抖音A代理', productKey: 'game-a', channelKey: 'douyin', feishuWebhook: 'demo-feishu-webhook://douyin-a', baseCpa: 84, day1: 37, day7: 14, baseActivations: 110, creatives: ['有声', '单本'] },
  { key: 'douyin-b', username: 'douyin-b', name: '演示-抖音B代理', productKey: 'game-b', channelKey: 'douyin', feishuWebhook: 'demo-feishu-webhook://douyin-b', baseCpa: 90, day1: 35, day7: 13, baseActivations: 92, creatives: ['短剧', '有声'] },
  { key: 'kuaishou-a', username: 'kuaishou-a', name: '演示-快手A代理', productKey: 'game-b', channelKey: 'kuaishou', feishuWebhook: 'demo-feishu-webhook://kuaishou-a', baseCpa: 86, day1: 36, day7: 13, baseActivations: 88, creatives: ['影游', '短剧'] },
  { key: 'kuaishou-b', username: 'kuaishou-b', name: '演示-快手B代理', productKey: 'game-b', channelKey: 'kuaishou', feishuWebhook: 'demo-feishu-webhook://kuaishou-b', baseCpa: 92, day1: 34, day7: 12, baseActivations: 76, creatives: ['单本', '有声'] },
  { key: 'xhs-a', username: 'xhs-a', name: '演示-小红书A代理', productKey: 'game-a', channelKey: 'xhs', feishuWebhook: 'demo-feishu-webhook://xhs-a', baseCpa: 78, day1: 39, day7: 16, baseActivations: 72, creatives: ['红包', '影游'] },
  { key: 'xhs-b', username: 'xhs-b', name: '演示-小红书B代理', productKey: 'game-b', channelKey: 'xhs', feishuWebhook: 'demo-feishu-webhook://xhs-b', baseCpa: 82, day1: 37, day7: 15, baseActivations: 68, creatives: ['短剧', '单本'] },
] as const;

const DEMO_AGENT_USERNAMES: string[] = DEMO_AGENTS.map((agent) => agent.username);
const CLEANUP_USERNAMES: string[] = [...DEMO_AGENT_USERNAMES, 'douyin-c'];
const MISSING_ON_FOCUS_DATE = new Set(['kuaishou-b', 'xhs-b']);
const DEMO_PASSWORD_BY_USERNAME = new Map<string, string>(
  DEMO_AGENT_CREDENTIALS.map((credential) => [credential.username, credential.password])
);

type DemoAgent = typeof DEMO_AGENTS[number];

interface InsertedRecord {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  creative_type: string;
  promotion_goal: string;
  cost: number | string | null;
  activations: number | string | null;
  cpa: number | string | null;
  ctr: number | string | null;
  cvr: number | string | null;
  cpm: number | string | null;
  retention_day1: number | string | null;
  retention_day7: number | string | null;
}

interface TargetSnapshot {
  effective_date: string;
  target_cpa: number;
  target_retention_day1: number;
  target_retention_day7: number;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function buildDemoPasswordHashByUsername() {
  return new Map(await Promise.all(DEMO_AGENT_USERNAMES.map(async (username) => {
    const password = DEMO_PASSWORD_BY_USERNAME.get(username);
    if (!password) {
      throw new Error(`Missing demo password for ${username}`);
    }
    return [username, await hashPassword(password)] as const;
  })));
}

function buildTargetSnapshots(agent: DemoAgent, focusDate: dayjs.Dayjs): TargetSnapshot[] {
  return [
    {
      effective_date: focusDate.subtract(45, 'day').format('YYYY-MM-DD'),
      target_cpa: agent.baseCpa,
      target_retention_day1: agent.day1,
      target_retention_day7: agent.day7,
    },
    {
      effective_date: focusDate.subtract(15, 'day').format('YYYY-MM-DD'),
      target_cpa: round(agent.baseCpa * 0.98),
      target_retention_day1: round(agent.day1 + 0.6),
      target_retention_day7: round(agent.day7 + 0.3),
    },
  ];
}

function buildRecordRows(
  agent: DemoAgent,
  agentId: string,
  productId: string,
  channelId: string,
  focusDate: dayjs.Dayjs
) {
  const rows = [];
  const startDate = focusDate.subtract(20, 'day');

  for (let dayIndex = 0; dayIndex < 21; dayIndex += 1) {
    const date = startDate.add(dayIndex, 'day');
    const recordDate = date.format('YYYY-MM-DD');
    const isFocusDate = recordDate === focusDate.format('YYYY-MM-DD');

    if (isFocusDate && MISSING_ON_FOCUS_DATE.has(agent.key)) {
      continue;
    }

    for (const [creativeIndex, creativeType] of agent.creatives.entries()) {
      const weekWave = Math.sin((dayIndex + creativeIndex) / 3.2);
      const targetShift = dayIndex >= 15 ? 0.98 : 1;
      let cpa = agent.baseCpa * targetShift * (0.91 + creativeIndex * 0.05 + weekWave * 0.035);
      let day1 = agent.day1 + (dayIndex >= 15 ? 0.5 : 0) - creativeIndex * 0.6 + Math.cos(dayIndex / 4) * 1.4;
      let day7 = agent.day7 + (dayIndex >= 15 ? 0.3 : 0) - creativeIndex * 0.4 + Math.sin(dayIndex / 5) * 0.8;
      const activationWave = Math.cos((dayIndex + creativeIndex) / 4) * 8;
      let activations = Math.max(22, Math.round(agent.baseActivations + dayIndex * 0.9 - creativeIndex * 13 + activationWave));

      if (isFocusDate && agent.key === 'gdt-a' && creativeType === '短剧') {
        cpa *= 1.42;
        day1 -= 11;
        day7 -= 5.2;
        activations = Math.max(18, Math.round(activations * 0.72));
      }

      if (isFocusDate && agent.key === 'douyin-b' && creativeType === '有声') {
        day1 -= 12.5;
        day7 -= 4.2;
      }

      if (isFocusDate && agent.key === 'kuaishou-a' && creativeType === '影游') {
        cpa *= 1.22;
        day7 -= 5.5;
      }

      const cost = round(cpa * activations);
      const ctr = 1.2 + creativeIndex * 0.18 + (dayIndex % 7) * 0.035;
      const cvr = 6.1 + creativeIndex * 0.45 + (dayIndex % 5) * 0.16;
      const cpm = 35 + creativeIndex * 4.5 + (dayIndex % 6) * 1.35;

      rows.push({
        agent_id: agentId,
        product_id: productId,
        channel_id: channelId,
        record_date: recordDate,
        creative_type: creativeType,
        promotion_goal: DEFAULT_PROMOTION_GOAL,
        cost,
        activations,
        cpa: activations > 0 ? round(cost / activations) : null,
        ctr: round(ctr),
        cvr: round(cvr),
        cpm: round(cpm),
        retention_day1: round(Math.max(5, day1)),
        retention_day7: round(Math.max(2, day7)),
        created_by: DEMO_CREATED_BY,
      });
    }
  }

  return rows;
}

async function deleteIfPresent<T>(
  query: PromiseLike<{ error: T | null }>
) {
  const { error } = await query;
  if (error) throw error;
}

async function clearDemoData(supabase: SupabaseClient) {
  const { data: candidateAgents, error: agentError } = await supabase
    .from('agents')
    .select('id, username, name, channel_id')
    .in('username', CLEANUP_USERNAMES);

  if (agentError) throw agentError;

  const demoAgents = (candidateAgents || []).filter((agent) => {
    const name = String(agent.name || '');
    return name.startsWith(DEMO_NAME_PREFIX) || LEGACY_DEMO_NAMES.has(name);
  });
  const demoAgentIds = demoAgents.map((agent) => agent.id as string);

  await deleteIfPresent(
    supabase
      .from('daily_records')
      .delete()
      .in('created_by', [DEMO_CREATED_BY, 'mock_csv'])
  );

  await deleteIfPresent(
    supabase
      .from('target_changes')
      .delete()
      .ilike('note', 'demo_seed%')
  );
  await deleteIfPresent(
    supabase
      .from('target_changes')
      .delete()
      .eq('note', 'mock CSV 导入自动生成')
  );

  if (demoAgentIds.length > 0) {
    await deleteIfPresent(
      supabase
        .from('agents')
        .delete()
        .in('id', demoAgentIds)
    );
  }

  const deletedChannels: string[] = [];
  for (const channel of DEMO_CHANNELS) {
    const { data: channelRow, error: channelError } = await supabase
      .from('channels')
      .select('id, name')
      .eq('name', channel.name)
      .maybeSingle();

    if (channelError) throw channelError;
    if (!channelRow) continue;

    const channelId = String(channelRow.id);
    const [{ count: agentCount, error: countAgentError }, { count: recordCount, error: countRecordError }, { count: targetCount, error: countTargetError }] = await Promise.all([
      supabase.from('agents').select('id', { count: 'exact', head: true }).eq('channel_id', channelId),
      supabase.from('daily_records').select('id', { count: 'exact', head: true }).eq('channel_id', channelId),
      supabase.from('target_changes').select('id', { count: 'exact', head: true }).eq('channel_id', channelId),
    ]);

    if (countAgentError) throw countAgentError;
    if (countRecordError) throw countRecordError;
    if (countTargetError) throw countTargetError;

    if ((agentCount || 0) === 0 && (recordCount || 0) === 0 && (targetCount || 0) === 0) {
      await deleteIfPresent(
        supabase
          .from('channels')
          .delete()
          .eq('id', channelId)
      );
      deletedChannels.push(channel.name);
    }
  }

  for (const product of DEMO_PRODUCTS) {
    const { data: productRow, error: productError } = await supabase
      .from('products')
      .select('id, name')
      .eq('name', product.name)
      .maybeSingle();

    if (productError) throw productError;
    if (!productRow) continue;

    const productId = String(productRow.id);
    const [{ count: agentCount, error: countAgentError }, { count: recordCount, error: countRecordError }, { count: targetCount, error: countTargetError }] = await Promise.all([
      supabase.from('agents').select('id', { count: 'exact', head: true }).eq('product_id', productId),
      supabase.from('daily_records').select('id', { count: 'exact', head: true }).eq('product_id', productId),
      supabase.from('target_changes').select('id', { count: 'exact', head: true }).eq('product_id', productId),
    ]);

    if (countAgentError) throw countAgentError;
    if (countRecordError) throw countRecordError;
    if (countTargetError) throw countTargetError;

    if ((agentCount || 0) === 0 && (recordCount || 0) === 0 && (targetCount || 0) === 0) {
      await deleteIfPresent(
        supabase
          .from('products')
          .delete()
          .eq('id', productId)
      );
    }
  }

  return {
    deleted_agents: demoAgents.length,
    deleted_channels: deletedChannels.length,
  };
}

function clearLocalDemoData(db: LocalDb) {
  const demoAgents = db.agents.filter((agent) => (
    CLEANUP_USERNAMES.includes(agent.username) &&
    (agent.name.startsWith(DEMO_NAME_PREFIX) || LEGACY_DEMO_NAMES.has(agent.name))
  ));
  const demoAgentIds = demoAgents.map((agent) => agent.id);

  cascadeDeleteRecords(db, (record) => record.created_by === DEMO_CREATED_BY || record.created_by === 'mock_csv');
  db.target_changes = db.target_changes.filter((target) => (
    !(target.note || '').startsWith('demo_seed') &&
    target.note !== 'mock CSV 导入自动生成'
  ));
  cascadeDeleteAgents(db, demoAgentIds);

  let deletedChannels = 0;
  for (const channel of DEMO_CHANNELS) {
    const row = db.channels.find((item) => item.name === channel.name);
    if (!row) continue;
    const hasRelations =
      db.agents.some((agent) => agent.channel_id === row.id) ||
      db.daily_records.some((record) => record.channel_id === row.id) ||
      db.target_changes.some((target) => target.channel_id === row.id);

    if (!hasRelations) {
      db.channels = db.channels.filter((item) => item.id !== row.id);
      deletedChannels += 1;
    }
  }

  for (const product of DEMO_PRODUCTS) {
    const row = db.products.find((item) => item.name === product.name);
    if (!row) continue;
    const hasRelations =
      db.agents.some((agent) => agent.product_id === row.id) ||
      db.daily_records.some((record) => record.product_id === row.id) ||
      db.target_changes.some((target) => target.product_id === row.id);

    if (!hasRelations) {
      db.products = db.products.filter((item) => item.id !== row.id);
    }
  }

  return {
    deleted_agents: demoAgents.length,
    deleted_channels: deletedChannels,
  };
}

async function initializeLocalDemo() {
  const passwordHashByUsername = await buildDemoPasswordHashByUsername();

  return mutateLocalDb((db) => {
    clearLocalDemoData(db);
    const conflictingAgents = db.agents.filter((agent) => DEMO_AGENT_USERNAMES.includes(agent.username));
    if (conflictingAgents.length > 0) {
      throw new Error(`存在同名非演示账号：${conflictingAgents.map((agent) => agent.username).join(', ')}。为避免覆盖真实账号，请先修改这些账号后再初始化。`);
    }

    const timestamp = nowIso();
    const productIdByKey = new Map<string, string>();
    for (const product of DEMO_PRODUCTS) {
      let row = db.products.find((item) => item.name === product.name);
      if (row) {
        row.is_active = true;
        row.updated_at = timestamp;
      } else {
        row = {
          id: newId(),
          name: product.name,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.products.push(row);
      }
      productIdByKey.set(product.key, row.id);
    }

    const channelIdByKey = new Map<string, string>();
    for (const channel of DEMO_CHANNELS) {
      let row = db.channels.find((item) => item.name === channel.name);
      if (row) {
        row.is_active = true;
        row.updated_at = timestamp;
      } else {
        row = {
          id: newId(),
          name: channel.name,
          is_active: true,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.channels.push(row);
      }
      channelIdByKey.set(channel.key, row.id);
    }

    const agentIdByUsername = new Map<string, string>();
    for (const agent of DEMO_AGENTS) {
      const row = {
        id: newId(),
        product_id: productIdByKey.get(agent.productKey)!,
        channel_id: channelIdByKey.get(agent.channelKey)!,
        name: agent.name,
        username: agent.username,
        creative_types: [...agent.creatives],
        feishu_webhook: agent.feishuWebhook,
        password_hash: passwordHashByUsername.get(agent.username)!,
        password_plaintext: DEMO_PASSWORD_BY_USERNAME.get(agent.username)!,
        is_active: true,
        created_at: timestamp,
        updated_at: timestamp,
      };
      db.agents.push(row);
      agentIdByUsername.set(agent.username, row.id);
      replaceLocalAgentScopes(db, row.id, agent.creatives.map((creativeType) => ({
        creative_type: creativeType,
        promotion_goal: DEFAULT_PROMOTION_GOAL,
      })));
    }

    const focusDate = dayjs().subtract(1, 'day');
    const recordIds: string[] = [];
    let targetCount = 0;

    for (const agent of DEMO_AGENTS) {
      const agentId = agentIdByUsername.get(agent.username)!;
      const productId = productIdByKey.get(agent.productKey)!;
      const channelId = channelIdByKey.get(agent.channelKey)!;
      const snapshots = buildTargetSnapshots(agent, focusDate);

      for (const creativeType of agent.creatives) {
        for (const [index, snapshot] of snapshots.entries()) {
          db.target_changes.push({
            id: newId(),
            agent_id: agentId,
            product_id: productId,
            channel_id: channelId,
            creative_type: creativeType,
            promotion_goal: DEFAULT_PROMOTION_GOAL,
            is_running: true,
            effective_date: snapshot.effective_date,
            target_cpa: snapshot.target_cpa,
            target_retention_day1: snapshot.target_retention_day1,
            target_retention_day7: snapshot.target_retention_day7,
            activation_cap: agent.baseActivations * 60,
            note: index === 0 ? 'demo_seed baseline' : 'demo_seed mid-month adjustment',
            created_at: timestamp,
            updated_at: timestamp,
          });
          targetCount += 1;
        }
      }

      const rows = buildRecordRows(agent, agentId, productId, channelId, focusDate);
      for (const row of rows) {
        const next = {
          id: newId(),
          ...row,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.daily_records.push(next);
        recordIds.push(next.id);
      }
    }

    const alerts = recalculateLocalAlertsForRecordIds(db, recordIds);
    const focusDateString = focusDate.format('YYYY-MM-DD');
    const focusFilledAgents = new Set(
      db.daily_records
        .filter((record) => recordIds.includes(record.id) && record.record_date === focusDateString)
        .map((record) => record.agent_id)
    );

    return {
      channels: DEMO_CHANNELS.length,
      agents: DEMO_AGENTS.length,
      target_changes: targetCount,
      daily_records: recordIds.length,
      alert_results: alerts.length,
      focus_date: focusDateString,
      missing_agents: DEMO_AGENTS.length - focusFilledAgents.size,
      credentials: DEMO_AGENT_CREDENTIALS,
      alert_count: alerts.filter((alert) => alert.has_alert).length,
    };
  });
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!hasSupabaseConfig()) {
      const data = await initializeLocalDemo();
      return NextResponse.json({
        success: true,
        data,
        message: `本地演示数据已初始化：${data.agents} 个代理账号，${data.daily_records} 行 21 天填报，${data.alert_count} 条异常提示。`,
      });
    }

    const supabase = createServerSupabase();
    await clearDemoData(supabase);

    const { data: conflictingAgents, error: conflictError } = await supabase
      .from('agents')
      .select('username, name')
      .in('username', DEMO_AGENT_USERNAMES);

    if (conflictError) throw conflictError;
    if ((conflictingAgents || []).length > 0) {
      return NextResponse.json({
        success: false,
        error: `存在同名非演示账号：${conflictingAgents?.map((agent) => agent.username).join(', ')}。为避免覆盖真实账号，请先修改这些账号后再初始化。`,
      }, { status: 409 });
    }

    const { data: products, error: productError } = await supabase
      .from('products')
      .upsert(DEMO_PRODUCTS.map((product) => ({
        name: product.name,
        is_active: true,
      })), { onConflict: 'name' })
      .select('id, name');

    if (productError) throw productError;

    const productByName = new Map((products || []).map((product) => [String(product.name), String(product.id)]));
    const productIdByKey = new Map(DEMO_PRODUCTS.map((product) => [product.key, productByName.get(product.name)!]));
    for (const product of DEMO_PRODUCTS) {
      if (!productIdByKey.get(product.key)) {
        throw new Error(`Missing demo product ${product.name}`);
      }
    }

    const { data: channels, error: channelError } = await supabase
      .from('channels')
      .upsert(DEMO_CHANNELS.map((channel) => ({
        name: channel.name,
        is_active: true,
      })), { onConflict: 'name' })
      .select('id, name');

    if (channelError) throw channelError;

    const channelByName = new Map((channels || []).map((channel) => [String(channel.name), String(channel.id)]));
    const channelIdByKey = new Map(DEMO_CHANNELS.map((channel) => [channel.key, channelByName.get(channel.name)!]));
    for (const channel of DEMO_CHANNELS) {
      if (!channelIdByKey.get(channel.key)) {
        throw new Error(`Missing demo channel ${channel.name}`);
      }
    }
    const passwordHashByUsername = await buildDemoPasswordHashByUsername();

    const { data: agents, error: insertAgentError } = await supabase
      .from('agents')
      .insert(DEMO_AGENTS.map((agent) => ({
        product_id: productIdByKey.get(agent.productKey),
        channel_id: channelIdByKey.get(agent.channelKey),
        name: agent.name,
        username: agent.username,
        creative_types: [...agent.creatives],
        feishu_webhook: agent.feishuWebhook,
        password_hash: passwordHashByUsername.get(agent.username),
        password_plaintext: DEMO_PASSWORD_BY_USERNAME.get(agent.username),
        is_active: true,
      })))
      .select('id, username, channel_id');

    if (insertAgentError) throw insertAgentError;

    const agentIdByUsername = new Map((agents || []).map((agent) => [String(agent.username), String(agent.id)]));
    const scopeRows = DEMO_AGENTS.flatMap((agent) => {
      const agentId = agentIdByUsername.get(agent.username);
      if (!agentId) return [];
      return agent.creatives.map((creativeType) => ({
        agent_id: agentId,
        creative_type: creativeType,
        promotion_goal: DEFAULT_PROMOTION_GOAL,
        is_active: true,
      }));
    });
    await upsertSupabaseDictionaries(supabase, scopeRows);
    const { error: scopeError } = await supabase
      .from('agent_authorized_scopes')
      .upsert(scopeRows, { onConflict: 'agent_id,creative_type,promotion_goal' });
    if (scopeError) throw scopeError;

    const focusDate = dayjs().subtract(1, 'day');
    const targetRows = [];
    const recordRows = [];

    for (const agent of DEMO_AGENTS) {
      const agentId = agentIdByUsername.get(agent.username);
      const productId = productIdByKey.get(agent.productKey);
      const channelId = channelIdByKey.get(agent.channelKey);
      if (!agentId || !productId || !channelId) {
        throw new Error(`Missing demo relation for ${agent.username}`);
      }

      const snapshots = buildTargetSnapshots(agent, focusDate);
      for (const creativeType of agent.creatives) {
        targetRows.push(...snapshots.map((snapshot, index) => ({
          agent_id: agentId,
          product_id: productId,
          channel_id: channelId,
          creative_type: creativeType,
          promotion_goal: DEFAULT_PROMOTION_GOAL,
          is_running: true,
          effective_date: snapshot.effective_date,
          target_cpa: snapshot.target_cpa,
          target_retention_day1: snapshot.target_retention_day1,
          target_retention_day7: snapshot.target_retention_day7,
          activation_cap: agent.baseActivations * 60,
          note: index === 0 ? 'demo_seed baseline' : 'demo_seed mid-month adjustment',
        })));
      }
      recordRows.push(...buildRecordRows(agent, agentId, productId, channelId, focusDate));
    }

    const { error: targetError } = await supabase
      .from('target_changes')
      .insert(targetRows);

    if (targetError) throw targetError;

    const insertedRecords: InsertedRecord[] = [];
    for (const rows of chunk(recordRows, 200)) {
      const { data, error } = await supabase
        .from('daily_records')
        .insert(rows)
        .select('id, agent_id, product_id, channel_id, record_date, creative_type, promotion_goal, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7');

      if (error) throw error;
      insertedRecords.push(...((data || []) as InsertedRecord[]));
    }

    const alertRows = await recalculateAlertsForRecordIds(supabase, insertedRecords.map((record) => record.id));
    await pruneSupabaseBusinessData(supabase);

    const focusDateString = focusDate.format('YYYY-MM-DD');
    const focusFilledAgents = new Set(
      insertedRecords
        .filter((record) => record.record_date === focusDateString)
        .map((record) => record.agent_id)
    );

    return NextResponse.json({
      success: true,
      data: {
        channels: DEMO_CHANNELS.length,
        agents: DEMO_AGENTS.length,
        target_changes: targetRows.length,
        daily_records: insertedRecords.length,
        alert_results: alertRows.length,
        focus_date: focusDateString,
        missing_agents: DEMO_AGENTS.length - focusFilledAgents.size,
        credentials: DEMO_AGENT_CREDENTIALS,
      },
      message: `演示数据已初始化：${DEMO_AGENTS.length} 个代理账号，${insertedRecords.length} 行 21 天填报，${alertRows.filter((alert) => alert.has_alert).length} 条异常提示。`,
    });
  } catch (error) {
    console.error('POST /api/demo error:', error);
    return NextResponse.json({ success: false, error: 'Failed to initialize demo data' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb((db) => clearLocalDemoData(db));
      return NextResponse.json({
        success: true,
        data: result,
        message: `本地演示数据已清空：删除 ${result.deleted_agents} 个演示账号，清理 ${result.deleted_channels} 个空演示渠道。`,
      });
    }

    const supabase = createServerSupabase();
    const result = await clearDemoData(supabase);

    return NextResponse.json({
      success: true,
      data: result,
      message: `演示数据已清空：删除 ${result.deleted_agents} 个演示账号，清理 ${result.deleted_channels} 个空演示渠道。`,
    });
  } catch (error) {
    console.error('DELETE /api/demo error:', error);
    return NextResponse.json({ success: false, error: 'Failed to clear demo data' }, { status: 500 });
  }
}
