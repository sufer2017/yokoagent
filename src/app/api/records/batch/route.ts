import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import type { BatchRecordRequest } from '@/types/api';

// POST /api/records/batch - Batch upsert records (agent only)
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'agent') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body: BatchRecordRequest = await request.json();
    const { records } = body;

    if (!records || records.length === 0) {
      return NextResponse.json({ success: false, error: '没有数据需要保存' }, { status: 400 });
    }

    const supabase = createServerSupabase();

    // Separate records with IDs (updates) from those without (inserts)
    const toUpdate = records.filter((r) => r.id);
    const toInsert = records.filter((r) => !r.id);

    const results = [];
    const errors = [];

    // Process inserts
    if (toInsert.length > 0) {
      const insertData = toInsert.map((r) => ({
        agent_id: session.agentId,
        record_date: r.record_date,
        channel_id: r.channel_id,
        project_id: r.project_id,
        cost: r.cost || 0,
        activations: r.activations || 0,
        retention_day1: r.retention_day1,
        retention_day7: r.retention_day7,
      }));

      const { data, error } = await supabase
        .from('daily_records')
        .upsert(insertData, {
          onConflict: 'agent_id,record_date,channel_id,project_id',
        })
        .select();

      if (error) {
        errors.push(`插入失败: ${error.message}`);
      } else {
        results.push(...(data || []));
      }
    }

    // Process updates
    for (const record of toUpdate) {
      const { data, error } = await supabase
        .from('daily_records')
        .update({
          record_date: record.record_date,
          channel_id: record.channel_id,
          project_id: record.project_id,
          cost: record.cost || 0,
          activations: record.activations || 0,
          retention_day1: record.retention_day1,
          retention_day7: record.retention_day7,
        })
        .eq('id', record.id!)
        .eq('agent_id', session.agentId!) // Ensure ownership
        .select()
        .single();

      if (error) {
        errors.push(`更新 ${record.id} 失败: ${error.message}`);
      } else {
        results.push(data);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      data: results,
      message: errors.length > 0
        ? `部分保存失败: ${errors.join('; ')}`
        : `成功保存 ${results.length} 条记录`,
      errors,
    });
  } catch (error) {
    console.error('POST /api/records/batch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to batch save records' }, { status: 500 });
  }
}
