import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { DEFAULT_PROMOTION_GOAL, normalizeDictionaryName } from '@/lib/admin/creativeTypes';
import { isSupabaseScopeAuthorized } from '@/lib/admin/scopes';
import type { BatchRecordRequest } from '@/types/api';
import {
  computedCpa,
  decorateRecord,
  isLocalScopeAuthorized,
  mutateLocalDb,
  newId,
  nowIso,
  recalculateLocalAlertsForRecordIds,
} from '@/lib/local-db/store';

function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

// POST /api/records/batch - Batch upsert records
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body: BatchRecordRequest = await request.json();
    const { records } = body;

    if (!records || records.length === 0) {
      return NextResponse.json({ success: false, error: '没有数据需要保存' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb((db) => {
        const timestamp = nowIso();
        const savedIds: string[] = [];
        const errors: string[] = [];

        for (const record of records) {
          const creativeType = normalizeDictionaryName(record.creative_type);
          const promotionGoal = normalizeDictionaryName(record.promotion_goal) || DEFAULT_PROMOTION_GOAL;
          if (!creativeType || !promotionGoal) {
            errors.push('保存失败: 请选择体裁和投放目标');
            continue;
          }
          if (record.id) {
            const existing = db.daily_records.find((item) => item.id === record.id);
            if (!existing) {
              errors.push(`更新 ${record.id} 失败: 记录不存在`);
              continue;
            }
            if (session.role === 'agent' && (existing.agent_id !== session.agentId || existing.product_id !== session.productId)) {
              errors.push(`更新 ${record.id} 失败: Forbidden`);
              continue;
            }
            if (session.role === 'agent' && !isLocalScopeAuthorized(db, session.agentId!, creativeType, promotionGoal)) {
              errors.push(`更新 ${record.id} 失败: 该体裁/投放目标未授权，请联系管理员配置`);
              continue;
            }

            Object.assign(existing, {
              record_date: record.record_date,
              creative_type: creativeType,
              promotion_goal: promotionGoal,
              cost: Number(record.cost || 0),
              activations: Number(record.activations || 0),
              cpa: computedCpa(record.cost, record.activations),
              ctr: toNumberOrNull(record.ctr),
              cvr: toNumberOrNull(record.cvr),
              cpm: toNumberOrNull(record.cpm),
              retention_day1: toNumberOrNull(record.retention_day1),
              retention_day7: toNumberOrNull(record.retention_day7),
              updated_at: timestamp,
            });
            savedIds.push(existing.id);
            continue;
          }

          const agentId = session.role === 'agent' ? session.agentId! : record.agent_id!;
          const productId = session.role === 'agent' ? session.productId! : record.product_id!;
          const channelId = session.role === 'agent' ? session.channelId! : record.channel_id!;
          if (session.role === 'agent' && !isLocalScopeAuthorized(db, agentId, creativeType, promotionGoal)) {
            errors.push(`${record.record_date}/${creativeType}/${promotionGoal} 未授权，请联系管理员配置`);
            continue;
          }
          const existing = db.daily_records.find((item) => (
            item.agent_id === agentId &&
            item.product_id === productId &&
            item.channel_id === channelId &&
            item.record_date === record.record_date &&
            item.creative_type === creativeType &&
            item.promotion_goal === promotionGoal
          ));

          if (existing) {
            Object.assign(existing, {
              cost: Number(record.cost || 0),
              activations: Number(record.activations || 0),
              cpa: computedCpa(record.cost, record.activations),
              ctr: toNumberOrNull(record.ctr),
              cvr: toNumberOrNull(record.cvr),
              cpm: toNumberOrNull(record.cpm),
              retention_day1: toNumberOrNull(record.retention_day1),
              retention_day7: toNumberOrNull(record.retention_day7),
              updated_at: timestamp,
            });
            savedIds.push(existing.id);
          } else {
            const next = {
              id: newId(),
              agent_id: agentId,
              product_id: productId,
              channel_id: channelId,
              record_date: record.record_date,
              creative_type: creativeType,
              promotion_goal: promotionGoal,
              cost: Number(record.cost || 0),
              activations: Number(record.activations || 0),
              cpa: computedCpa(record.cost, record.activations),
              ctr: toNumberOrNull(record.ctr),
              cvr: toNumberOrNull(record.cvr),
              cpm: toNumberOrNull(record.cpm),
              retention_day1: toNumberOrNull(record.retention_day1),
              retention_day7: toNumberOrNull(record.retention_day7),
              created_by: session.role === 'agent' ? session.agentName || null : 'admin',
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.daily_records.push(next);
            savedIds.push(next.id);
          }
        }

        recalculateLocalAlertsForRecordIds(db, savedIds);
        const savedRecords = savedIds
          .map((id) => db.daily_records.find((record) => record.id === id))
          .filter((record): record is NonNullable<typeof record> => Boolean(record))
          .map((record) => decorateRecord(db, record));

        return { savedRecords, errors };
      });

      return NextResponse.json({
        success: result.errors.length === 0,
        data: result.savedRecords,
        message: result.errors.length > 0
          ? `部分保存失败: ${result.errors.join('; ')}`
          : `成功保存 ${result.savedRecords.length} 条记录，站内告警已重算`,
        errors: result.errors,
      });
    }

    const supabase = createServerSupabase();
    const toUpdate = records.filter((record) => record.id);
    const toInsert = records.filter((record) => !record.id);
    const results = [];
    const errors = [];

    if (toInsert.length > 0) {
      const insertData = toInsert.map((record) => {
        const agentId = session.role === 'agent' ? session.agentId : record.agent_id;
        const productId = session.role === 'agent' ? session.productId : record.product_id;
        const channelId = session.role === 'agent' ? session.channelId : record.channel_id;
        const creativeType = normalizeDictionaryName(record.creative_type);
        const promotionGoal = normalizeDictionaryName(record.promotion_goal) || DEFAULT_PROMOTION_GOAL;

        return {
          agent_id: agentId,
          product_id: productId,
          channel_id: channelId,
          record_date: record.record_date,
          creative_type: creativeType,
          promotion_goal: promotionGoal,
          cost: record.cost || 0,
          activations: record.activations || 0,
          cpa: computedCpa(record.cost, record.activations),
          ctr: toNumberOrNull(record.ctr),
          cvr: toNumberOrNull(record.cvr),
          cpm: toNumberOrNull(record.cpm),
          retention_day1: toNumberOrNull(record.retention_day1),
          retention_day7: toNumberOrNull(record.retention_day7),
          created_by: session.role === 'agent' ? session.agentName : 'admin',
        };
      });
      const allowedInsertData = [];
      for (const record of insertData) {
        if (!record.creative_type || !record.promotion_goal) {
          errors.push(`${record.record_date} 保存失败: 请选择体裁和投放目标`);
          continue;
        }
        if (session.role === 'agent') {
          const authorized = await isSupabaseScopeAuthorized(supabase, session.agentId!, record.creative_type, record.promotion_goal);
          if (!authorized) {
            errors.push(`${record.record_date}/${record.creative_type}/${record.promotion_goal} 未授权，请联系管理员配置`);
            continue;
          }
        }
        allowedInsertData.push(record);
      }

      const { data, error } = allowedInsertData.length > 0
        ? await supabase
          .from('daily_records')
          .upsert(allowedInsertData, {
            onConflict: 'product_id,agent_id,channel_id,record_date,creative_type,promotion_goal',
          })
          .select()
        : { data: [], error: null };

      if (error) {
        errors.push(`插入失败: ${error.message}`);
      } else {
        results.push(...(data || []));
      }
    }

    for (const record of toUpdate) {
      const creativeType = normalizeDictionaryName(record.creative_type);
      const promotionGoal = normalizeDictionaryName(record.promotion_goal) || DEFAULT_PROMOTION_GOAL;
      if (session.role === 'agent') {
        const authorized = await isSupabaseScopeAuthorized(supabase, session.agentId!, creativeType, promotionGoal);
        if (!authorized) {
          errors.push(`更新 ${record.id} 失败: 该体裁/投放目标未授权，请联系管理员配置`);
          continue;
        }
      }
      let updateQuery = supabase
        .from('daily_records')
        .update({
          record_date: record.record_date,
          creative_type: creativeType,
          promotion_goal: promotionGoal,
          cost: record.cost || 0,
          activations: record.activations || 0,
          cpa: computedCpa(record.cost, record.activations),
          ctr: toNumberOrNull(record.ctr),
          cvr: toNumberOrNull(record.cvr),
          cpm: toNumberOrNull(record.cpm),
          retention_day1: toNumberOrNull(record.retention_day1),
          retention_day7: toNumberOrNull(record.retention_day7),
        })
        .eq('id', record.id!);

      if (session.role === 'agent') {
        updateQuery = updateQuery.eq('agent_id', session.agentId!);
      }

      const { data, error } = await updateQuery.select().single();

      if (error) {
        errors.push(`更新 ${record.id} 失败: ${error.message}`);
      } else {
        results.push(data);
      }
    }

    await recalculateAlertsForRecordIds(
      supabase,
      results.map((record: { id: string }) => record.id)
    );
    await pruneSupabaseBusinessData(supabase);

    return NextResponse.json({
      success: errors.length === 0,
      data: results,
      message: errors.length > 0
        ? `部分保存失败: ${errors.join('; ')}`
        : `成功保存 ${results.length} 条记录，站内告警已重算`,
      errors,
    });
  } catch (error) {
    console.error('POST /api/records/batch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to batch save records' }, { status: 500 });
  }
}
