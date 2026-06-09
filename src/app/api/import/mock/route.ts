import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { generateAgentPassword } from '@/lib/admin/passwords';
import { DEFAULT_PROMOTION_GOAL, normalizeCreativeTypes, normalizeDictionaryName } from '@/lib/admin/creativeTypes';
import {
  mutateLocalDb,
  newId,
  nowIso,
  recalculateLocalAlertsForRecordIds,
} from '@/lib/local-db/store';

const HEADER_MAP: Record<string, string> = {
  日期: 'record_date',
  产品: 'product_name',
  渠道: 'channel_name',
  代理商名称: 'agent_name',
  代理商: 'agent_name',
  体裁: 'creative_type',
  投放目标: 'promotion_goal',
  消耗: 'cost',
  激活数: 'activations',
  CPA: 'cpa',
  CTR: 'ctr',
  CVR: 'cvr',
  CPM: 'cpm',
  填写人: 'created_by',
  '次留（T-2）': 'retention_day1',
  '次留(T-2)': 'retention_day1',
  次留: 'retention_day1',
  '7留（T-8）': 'retention_day7',
  '7留(T-8)': 'retention_day7',
  '7留': 'retention_day7',
  考核CPA: 'target_cpa',
  考核次留: 'target_retention_day1',
  考核7留: 'target_retention_day7',
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeNumber(value: string | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/%/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const next = Number(cleaned);
  return Number.isFinite(next) ? next : null;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'agent';
}

function parseCsv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => HEADER_MAP[header] || header);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] || '';
      return row;
    }, {});
  });
}

async function getOrCreateChannel(
  supabase: ReturnType<typeof createServerSupabase>,
  name: string
) {
  const trimmed = name.trim();
  const { data: existing } = await supabase
    .from('channels')
    .select('id, name')
    .eq('name', trimmed)
    .maybeSingle();

  if (existing) return existing as { id: string; name: string };

  const { data, error } = await supabase
    .from('channels')
    .insert({ name: trimmed })
    .select('id, name')
    .single();

  if (error) throw error;
  return data as { id: string; name: string };
}

async function getOrCreateProduct(
  supabase: ReturnType<typeof createServerSupabase>,
  name: string
) {
  const trimmed = name.trim() || '默认产品';
  const { data: existing } = await supabase
    .from('products')
    .select('id, name')
    .eq('name', trimmed)
    .maybeSingle();

  if (existing) return existing as { id: string; name: string };

  const { data, error } = await supabase
    .from('products')
    .insert({ name: trimmed })
    .select('id, name')
    .single();

  if (error) throw error;
  return data as { id: string; name: string };
}

async function getOrCreateAgent(
  supabase: ReturnType<typeof createServerSupabase>,
  productId: string,
  channelId: string,
  channelName: string,
  name: string,
  creativeType: string,
  promotionGoal: string,
  createdCredentials: Array<{ username: string; password: string }>
) {
  const trimmed = name.trim();
  const { data: existing } = await supabase
    .from('agents')
    .select('id, name, product_id, channel_id, creative_types')
    .eq('product_id', productId)
    .eq('channel_id', channelId)
    .eq('name', trimmed)
    .maybeSingle();

  if (existing) {
    const existingCreativeTypes = normalizeCreativeTypes((existing as { creative_types?: unknown }).creative_types);
    const nextCreativeTypes = normalizeCreativeTypes([...existingCreativeTypes, creativeType]);
    if (nextCreativeTypes.length !== existingCreativeTypes.length) {
      const { error: updateError } = await supabase
        .from('agents')
        .update({ creative_types: nextCreativeTypes })
        .eq('id', existing.id);
      if (updateError) throw updateError;
    }
    await supabase.from('creative_types').upsert({ name: creativeType, is_active: true }, { onConflict: 'name' });
    await supabase.from('promotion_goals').upsert({ name: promotionGoal, is_active: true }, { onConflict: 'name' });
    await supabase.from('agent_authorized_scopes').upsert({
      agent_id: existing.id,
      creative_type: creativeType,
      promotion_goal: promotionGoal,
      is_active: true,
    }, { onConflict: 'agent_id,creative_type,promotion_goal' });
    return existing as { id: string; name: string; product_id: string; channel_id: string };
  }

  const username = `${slug(channelName)}-${slug(trimmed)}`;
  const password = generateAgentPassword();
  const { data, error } = await supabase
    .from('agents')
    .insert({
      channel_id: channelId,
      product_id: productId,
      name: trimmed,
      username,
      creative_types: normalizeCreativeTypes(creativeType),
      feishu_webhook: '',
      password_hash: await hashPassword(password),
      password_plaintext: password,
    })
    .select('id, name, product_id, channel_id')
    .single();

  if (error) throw error;
  await supabase.from('creative_types').upsert({ name: creativeType, is_active: true }, { onConflict: 'name' });
  await supabase.from('promotion_goals').upsert({ name: promotionGoal, is_active: true }, { onConflict: 'name' });
  await supabase.from('agent_authorized_scopes').upsert({
    agent_id: data.id,
    creative_type: creativeType,
    promotion_goal: promotionGoal,
    is_active: true,
  }, { onConflict: 'agent_id,creative_type,promotion_goal' });
  createdCredentials.push({ username, password });
  return data as { id: string; name: string; product_id: string; channel_id: string };
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const rows = parseCsv(String(body.csvText || ''));
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'CSV 没有可导入数据' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb(async (db) => {
        const timestamp = nowIso();
        const recordIds: string[] = [];
        const errors: string[] = [];
        const createdCredentials: Array<{ username: string; password: string }> = [];

        for (const [index, row] of rows.entries()) {
          const recordDate = row.record_date;
          const productName = row.product_name || '默认产品';
          const channelName = row.channel_name;
          const agentName = row.agent_name;
          const creativeType = row.creative_type;
          const promotionGoal = normalizeDictionaryName(row.promotion_goal) || DEFAULT_PROMOTION_GOAL;

          if (!recordDate || !channelName || !agentName || !creativeType || !promotionGoal) {
            errors.push(`第 ${index + 2} 行缺少 日期/渠道/代理商/体裁/投放目标`);
            continue;
          }

          let product = db.products.find((item) => item.name === productName.trim());
          if (!product) {
            product = {
              id: newId(),
              name: productName.trim(),
              is_active: true,
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.products.push(product);
          }

          let channel = db.channels.find((item) => item.name === channelName.trim());
          if (!channel) {
            channel = {
              id: newId(),
              name: channelName.trim(),
              is_active: true,
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.channels.push(channel);
          }

          let agent = db.agents.find((item) => item.product_id === product.id && item.channel_id === channel.id && item.name === agentName.trim());
          if (!agent) {
            const username = `${slug(channel.name)}-${slug(agentName)}`;
            const password = generateAgentPassword();
            agent = {
              id: newId(),
              product_id: product.id,
              channel_id: channel.id,
              name: agentName.trim(),
              username,
              creative_types: normalizeCreativeTypes(creativeType),
              feishu_webhook: '',
              password_hash: await hashPassword(password),
              password_plaintext: password,
              is_active: true,
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.agents.push(agent);
            createdCredentials.push({ username, password });
          } else {
            agent.creative_types = normalizeCreativeTypes([...(agent.creative_types || []), creativeType]);
            agent.updated_at = timestamp;
          }
          if (!db.agent_authorized_scopes.some((scope) => scope.agent_id === agent.id && scope.creative_type === creativeType.trim() && scope.promotion_goal === promotionGoal)) {
            db.agent_authorized_scopes.push({
              id: newId(),
              agent_id: agent.id,
              creative_type: creativeType.trim(),
              promotion_goal: promotionGoal,
              is_active: true,
              created_at: timestamp,
              updated_at: timestamp,
            });
          }

          const targetCpa = normalizeNumber(row.target_cpa);
          const targetDay1 = normalizeNumber(row.target_retention_day1);
          const targetDay7 = normalizeNumber(row.target_retention_day7);
          if (targetCpa != null || targetDay1 != null || targetDay7 != null) {
            const effectiveDate = dayjs(recordDate).subtract(30, 'day').format('YYYY-MM-DD');
            const existingTarget = db.target_changes.find((target) => (
              target.agent_id === agent.id &&
              target.product_id === product.id &&
              target.channel_id === channel.id &&
              target.creative_type === creativeType.trim() &&
              target.promotion_goal === promotionGoal &&
              target.effective_date === effectiveDate
            ));
            if (existingTarget) {
              Object.assign(existingTarget, {
                is_running: true,
                product_id: product.id,
                creative_type: creativeType.trim(),
                promotion_goal: promotionGoal,
                target_cpa: targetCpa,
                target_retention_day1: targetDay1,
                target_retention_day7: targetDay7,
                activation_cap: null,
                note: '历史 CSV 导入自动生成',
                updated_at: timestamp,
              });
            } else {
              db.target_changes.push({
                id: newId(),
                agent_id: agent.id,
                product_id: product.id,
                channel_id: channel.id,
                creative_type: creativeType.trim(),
                promotion_goal: promotionGoal,
                effective_date: effectiveDate,
                is_running: true,
                target_cpa: targetCpa,
                target_retention_day1: targetDay1,
                target_retention_day7: targetDay7,
                activation_cap: null,
                note: '历史 CSV 导入自动生成',
                created_at: timestamp,
                updated_at: timestamp,
              });
            }
          }

          const existingRecord = db.daily_records.find((record) => (
            record.agent_id === agent.id &&
            record.product_id === product.id &&
            record.channel_id === channel.id &&
            record.record_date === recordDate &&
            record.creative_type === creativeType.trim() &&
            record.promotion_goal === promotionGoal
          ));
          const recordPayload = {
            agent_id: agent.id,
            product_id: product.id,
            channel_id: channel.id,
            record_date: recordDate,
            creative_type: creativeType.trim(),
            promotion_goal: promotionGoal,
            cost: normalizeNumber(row.cost) || 0,
            activations: normalizeNumber(row.activations) || 0,
            cpa: (normalizeNumber(row.activations) || 0) > 0 ? Number(((normalizeNumber(row.cost) || 0) / (normalizeNumber(row.activations) || 1)).toFixed(2)) : null,
            ctr: normalizeNumber(row.ctr),
            cvr: normalizeNumber(row.cvr),
            cpm: normalizeNumber(row.cpm),
            retention_day1: normalizeNumber(row.retention_day1),
            retention_day7: normalizeNumber(row.retention_day7),
            created_by: row.created_by?.trim() || 'admin_import',
            updated_at: timestamp,
          };

          if (existingRecord) {
            Object.assign(existingRecord, recordPayload);
            recordIds.push(existingRecord.id);
          } else {
            const next = {
              id: newId(),
              ...recordPayload,
              created_at: timestamp,
            };
            db.daily_records.push(next);
            recordIds.push(next.id);
          }
        }

        recalculateLocalAlertsForRecordIds(db, recordIds);
        return { imported: recordIds.length, errors, createdCredentials };
      });

      return NextResponse.json({
        success: result.errors.length === 0,
        data: result,
        message: `已导入 ${result.imported} 条本地记录，站内告警已重算`,
      });
    }

    const supabase = createServerSupabase();
    const recordIds: string[] = [];
    const errors: string[] = [];
    const createdCredentials: Array<{ username: string; password: string }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const recordDate = row.record_date;
        const productName = row.product_name || '默认产品';
        const channelName = row.channel_name;
        const agentName = row.agent_name;
        const creativeType = row.creative_type;
        const promotionGoal = normalizeDictionaryName(row.promotion_goal) || DEFAULT_PROMOTION_GOAL;

        if (!recordDate || !channelName || !agentName || !creativeType || !promotionGoal) {
          errors.push(`第 ${index + 2} 行缺少 日期/渠道/代理商/体裁/投放目标`);
          continue;
        }

        const product = await getOrCreateProduct(supabase, productName);
        const channel = await getOrCreateChannel(supabase, channelName);
        const agent = await getOrCreateAgent(supabase, product.id, channel.id, channel.name, agentName, creativeType, promotionGoal, createdCredentials);

        const targetCpa = normalizeNumber(row.target_cpa);
        const targetDay1 = normalizeNumber(row.target_retention_day1);
        const targetDay7 = normalizeNumber(row.target_retention_day7);
        if (targetCpa != null || targetDay1 != null || targetDay7 != null) {
          await supabase
            .from('target_changes')
            .upsert({
              agent_id: agent.id,
              product_id: product.id,
              channel_id: channel.id,
              creative_type: creativeType.trim(),
              promotion_goal: promotionGoal,
              effective_date: dayjs(recordDate).subtract(30, 'day').format('YYYY-MM-DD'),
              is_running: true,
              target_cpa: targetCpa,
              target_retention_day1: targetDay1,
              target_retention_day7: targetDay7,
              note: '历史 CSV 导入自动生成',
            }, {
              onConflict: 'product_id,agent_id,channel_id,creative_type,promotion_goal,effective_date',
            });
        }

        const { data, error } = await supabase
          .from('daily_records')
          .upsert({
            agent_id: agent.id,
            product_id: product.id,
            channel_id: channel.id,
            record_date: recordDate,
            creative_type: creativeType.trim(),
            promotion_goal: promotionGoal,
            cost: normalizeNumber(row.cost) || 0,
            activations: normalizeNumber(row.activations) || 0,
            cpa: (normalizeNumber(row.activations) || 0) > 0 ? Number(((normalizeNumber(row.cost) || 0) / (normalizeNumber(row.activations) || 1)).toFixed(2)) : null,
            ctr: normalizeNumber(row.ctr),
            cvr: normalizeNumber(row.cvr),
            cpm: normalizeNumber(row.cpm),
            retention_day1: normalizeNumber(row.retention_day1),
            retention_day7: normalizeNumber(row.retention_day7),
            created_by: row.created_by?.trim() || 'admin_import',
          }, {
            onConflict: 'product_id,agent_id,channel_id,record_date,creative_type,promotion_goal',
          })
          .select('id')
          .single();

        if (error) throw error;
        recordIds.push(data.id);
      } catch (error) {
        errors.push(`第 ${index + 2} 行导入失败: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    await recalculateAlertsForRecordIds(supabase, recordIds);
    await pruneSupabaseBusinessData(supabase);

    return NextResponse.json({
      success: errors.length === 0,
      data: { imported: recordIds.length, errors, createdCredentials },
      message: `已导入 ${recordIds.length} 条记录，站内告警已重算`,
    });
  } catch (error) {
    console.error('POST /api/import/mock error:', error);
    return NextResponse.json({ success: false, error: 'Failed to import mock CSV' }, { status: 500 });
  }
}
