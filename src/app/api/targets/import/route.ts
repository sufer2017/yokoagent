import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { isYmdDate, missingHeaders, normalizeNumber, parseBoolean, parseCsv } from '@/lib/admin/csv';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { DEFAULT_PROMOTION_GOAL, normalizeDictionaryName } from '@/lib/admin/creativeTypes';
import { decorateTarget, isLocalScopeAuthorized, mutateLocalDb, newId, nowIso, recalculateLocalAlertsForRecordIds } from '@/lib/local-db/store';
import { isSupabaseScopeAuthorized } from '@/lib/admin/scopes';

const HEADER_ALIASES: Record<string, string> = {
  产品: 'product_name',
  产品名称: 'product_name',
  渠道: 'channel_name',
  代理商名称: 'agent_name',
  代理商: 'agent_name',
  体裁: 'creative_type',
  投放目标: 'promotion_goal',
  是否在投: 'is_running',
  考核生效日期: 'effective_date',
  考核CPA: 'target_cpa',
  考核次留: 'target_retention_day1',
  考核7留: 'target_retention_day7',
  激活量级上限: 'activation_cap',
  激活上限: 'activation_cap',
  备注: 'note',
};

const REQUIRED_HEADERS = [
  'product_name',
  'channel_name',
  'agent_name',
  'creative_type',
  'promotion_goal',
  'is_running',
  'effective_date',
  'target_cpa',
  'target_retention_day1',
  'target_retention_day7',
];

async function readCsvText(request: Request) {
  const body = await request.json();
  return String(body.csvText || '');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = parseCsv(await readCsvText(request), HEADER_ALIASES);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'CSV 没有可导入数据' }, { status: 400 });
    }

    const headerMissing = missingHeaders(parsed.headers, REQUIRED_HEADERS);
    if (headerMissing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `CSV 缺少必填表头: ${headerMissing.join(', ')}`,
      }, { status: 400 });
    }

    const seen = new Set<string>();

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb((db) => {
        const timestamp = nowIso();
        const errors: string[] = [];
        const affectedRecordIds: string[] = [];
        let imported = 0;

        for (const [index, row] of parsed.rows.entries()) {
          const line = index + 2;
          const productName = row.product_name?.trim();
          const channelName = row.channel_name?.trim();
          const agentName = row.agent_name?.trim();
          const creativeType = row.creative_type?.trim();
          const promotionGoal = normalizeDictionaryName(row.promotion_goal) || DEFAULT_PROMOTION_GOAL;
          const effectiveDate = row.effective_date?.trim();
          const running = parseBoolean(row.is_running, true);
          const key = `${productName}:${channelName}:${agentName}:${creativeType}:${promotionGoal}:${effectiveDate}`;

          if (!productName || !channelName || !agentName || !creativeType || !promotionGoal || !effectiveDate) {
            errors.push(`第 ${line} 行缺少 产品/渠道/代理商名称/体裁/投放目标/考核生效日期`);
            continue;
          }
          if (!isYmdDate(effectiveDate)) {
            errors.push(`第 ${line} 行考核生效日期必须是 YYYY-MM-DD`);
            continue;
          }
          if (running == null) {
            errors.push(`第 ${line} 行是否在投只能填写 是/否`);
            continue;
          }
          if (seen.has(key)) {
            errors.push(`第 ${line} 行与前文重复: ${productName}/${channelName}/${agentName}/${creativeType}/${effectiveDate}`);
            continue;
          }
          seen.add(key);

          const product = db.products.find((item) => item.name === productName);
          const channel = db.channels.find((item) => item.name === channelName);
          const agent = product && channel ? db.agents.find((item) => item.product_id === product.id && item.channel_id === channel.id && item.name === agentName) : null;
          if (!product || !channel || !agent) {
            errors.push(`第 ${line} 行未知代理: ${productName}/${channelName}/${agentName}`);
            continue;
          }
          if (!isLocalScopeAuthorized(db, agent.id, creativeType, promotionGoal)) {
            errors.push(`第 ${line} 行代理未授权组合: ${agentName}/${creativeType}/${promotionGoal}`);
            continue;
          }

          const payload = {
            agent_id: agent.id,
            product_id: product.id,
            channel_id: channel.id,
            creative_type: creativeType,
            promotion_goal: promotionGoal,
            effective_date: effectiveDate,
            is_running: running,
            target_cpa: normalizeNumber(row.target_cpa),
            target_retention_day1: normalizeNumber(row.target_retention_day1),
            target_retention_day7: normalizeNumber(row.target_retention_day7),
            activation_cap: normalizeNumber(row.activation_cap),
            note: row.note?.trim() || null,
            updated_at: timestamp,
          };

          const existing = db.target_changes.find((target) => (
            target.agent_id === agent.id &&
            target.product_id === product.id &&
            target.channel_id === channel.id &&
            target.creative_type === creativeType &&
            target.promotion_goal === promotionGoal &&
            target.effective_date === effectiveDate
          ));

          if (existing) {
            Object.assign(existing, payload);
          } else {
            db.target_changes.push({
              id: newId(),
              ...payload,
              created_at: timestamp,
            });
          }
          affectedRecordIds.push(...db.daily_records
            .filter((record) => record.agent_id === agent.id && record.product_id === product.id && record.channel_id === channel.id && record.creative_type === creativeType && record.promotion_goal === promotionGoal && record.record_date >= effectiveDate)
            .map((record) => record.id));
          imported += 1;
        }

        recalculateLocalAlertsForRecordIds(db, affectedRecordIds);

        return {
          imported,
          errors,
          targets: db.target_changes.map((target) => decorateTarget(db, target)),
        };
      });

      return NextResponse.json({
        success: result.errors.length === 0,
        data: result,
        message: `已导入/更新 ${result.imported} 条考核记录`,
      });
    }

    const supabase = createServerSupabase();
    const errors: string[] = [];
    const affectedRecordIds: string[] = [];
    let imported = 0;

    for (const [index, row] of parsed.rows.entries()) {
      const line = index + 2;
      try {
        const productName = row.product_name?.trim();
        const channelName = row.channel_name?.trim();
        const agentName = row.agent_name?.trim();
        const creativeType = row.creative_type?.trim();
        const promotionGoal = normalizeDictionaryName(row.promotion_goal) || DEFAULT_PROMOTION_GOAL;
        const effectiveDate = row.effective_date?.trim();
        const running = parseBoolean(row.is_running, true);
        const key = `${productName}:${channelName}:${agentName}:${creativeType}:${promotionGoal}:${effectiveDate}`;

        if (!productName || !channelName || !agentName || !creativeType || !promotionGoal || !effectiveDate) {
          errors.push(`第 ${line} 行缺少 产品/渠道/代理商名称/体裁/投放目标/考核生效日期`);
          continue;
        }
        if (!isYmdDate(effectiveDate)) {
          errors.push(`第 ${line} 行考核生效日期必须是 YYYY-MM-DD`);
          continue;
        }
        if (running == null) {
          errors.push(`第 ${line} 行是否在投只能填写 是/否`);
          continue;
        }
        if (seen.has(key)) {
          errors.push(`第 ${line} 行与前文重复: ${productName}/${channelName}/${agentName}/${creativeType}/${effectiveDate}`);
          continue;
        }
        seen.add(key);

        const { data: product } = await supabase
          .from('products')
          .select('id')
          .eq('name', productName)
          .maybeSingle();
        const { data: channel } = await supabase
          .from('channels')
          .select('id')
          .eq('name', channelName)
          .maybeSingle();
        const { data: agent } = product && channel ? await supabase
          .from('agents')
          .select('id, product_id, channel_id')
          .eq('product_id', product.id)
          .eq('channel_id', channel.id)
          .eq('name', agentName)
          .maybeSingle() : { data: null };

        if (!product || !channel || !agent) {
          errors.push(`第 ${line} 行未知代理: ${productName}/${channelName}/${agentName}`);
          continue;
        }
        const authorized = await isSupabaseScopeAuthorized(supabase, agent.id, creativeType, promotionGoal);
        if (!authorized) {
          errors.push(`第 ${line} 行代理未授权组合: ${agentName}/${creativeType}/${promotionGoal}`);
          continue;
        }

        const { error } = await supabase
          .from('target_changes')
          .upsert({
            agent_id: agent.id,
            product_id: product.id,
            channel_id: channel.id,
            creative_type: creativeType,
            promotion_goal: promotionGoal,
            effective_date: effectiveDate,
            is_running: running,
            target_cpa: normalizeNumber(row.target_cpa),
            target_retention_day1: normalizeNumber(row.target_retention_day1),
            target_retention_day7: normalizeNumber(row.target_retention_day7),
            activation_cap: normalizeNumber(row.activation_cap),
            note: row.note?.trim() || null,
          }, { onConflict: 'product_id,agent_id,channel_id,creative_type,promotion_goal,effective_date' });

        if (error) throw error;
        const { data: affectedRecords, error: recordsError } = await supabase
          .from('daily_records')
          .select('id')
          .eq('agent_id', agent.id)
          .eq('product_id', product.id)
          .eq('channel_id', channel.id)
          .eq('creative_type', creativeType)
          .eq('promotion_goal', promotionGoal)
          .gte('record_date', effectiveDate);
        if (recordsError) throw recordsError;
        affectedRecordIds.push(...(affectedRecords || []).map((record: { id: string }) => record.id));
        imported += 1;
      } catch (error) {
        errors.push(`第 ${line} 行导入失败: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    await recalculateAlertsForRecordIds(supabase, affectedRecordIds);
    await pruneSupabaseBusinessData(supabase);

    return NextResponse.json({
      success: errors.length === 0,
      data: { imported, errors },
      message: `已导入/更新 ${imported} 条考核记录`,
    });
  } catch (error) {
    console.error('POST /api/targets/import error:', error);
    return NextResponse.json({ success: false, error: 'Failed to import targets' }, { status: 500 });
  }
}
