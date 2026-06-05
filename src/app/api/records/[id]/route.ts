import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { verifyRecordOwnership } from '@/lib/helpers/agentQuery';
import { recalculateAlertsForRecordIds } from '@/lib/alerts/engine';
import { pruneSupabaseBusinessData } from '@/lib/admin/retention';
import {
  cascadeDeleteRecords,
  computedCpa,
  decorateRecord,
  mutateLocalDb,
  nowIso,
  recalculateLocalAlertsForRecordIds,
} from '@/lib/local-db/store';

type CostActivationSnapshot = {
  cost: number | string | null;
  activations: number | string | null;
};

function toNumberOrNull(value: unknown) {
  if (value === '' || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

// PATCH /api/records/[id] - Update a record
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const record = db.daily_records.find((item) => item.id === id);
        if (!record) throw new Error('Record not found');
        if (session.role === 'agent' && (record.agent_id !== session.agentId || record.product_id !== session.productId)) {
          throw new Error('Forbidden');
        }
        if (body.record_date !== undefined) record.record_date = body.record_date;
        if (body.creative_type !== undefined) record.creative_type = String(body.creative_type).trim();
        if (body.cost !== undefined) record.cost = Number(body.cost || 0);
        if (body.activations !== undefined) record.activations = Number(body.activations || 0);
        record.cpa = computedCpa(record.cost, record.activations);
        if (body.ctr !== undefined) record.ctr = toNumberOrNull(body.ctr);
        if (body.cvr !== undefined) record.cvr = toNumberOrNull(body.cvr);
        if (body.cpm !== undefined) record.cpm = toNumberOrNull(body.cpm);
        if (body.retention_day1 !== undefined) record.retention_day1 = toNumberOrNull(body.retention_day1);
        if (body.retention_day7 !== undefined) record.retention_day7 = toNumberOrNull(body.retention_day7);
        record.updated_at = nowIso();
        recalculateLocalAlertsForRecordIds(db, [record.id]);
        return decorateRecord(db, record);
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();

    // Agents can only update their own records
    if (session.role === 'agent') {
      const isOwner = await verifyRecordOwnership(supabase, id, session.agentId!);
      if (!isOwner) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = {};
    let currentRecord: CostActivationSnapshot | null = null;
    if (body.cost !== undefined || body.activations !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from('daily_records')
        .select('cost, activations')
        .eq('id', id)
        .maybeSingle();
      if (currentError) throw currentError;
      currentRecord = current as CostActivationSnapshot | null;
    }
    if (body.record_date !== undefined) updateData.record_date = body.record_date;
    if (body.creative_type !== undefined) updateData.creative_type = String(body.creative_type).trim();
    if (body.cost !== undefined) updateData.cost = body.cost;
    if (body.activations !== undefined) updateData.activations = body.activations;
    if (body.cost !== undefined || body.activations !== undefined) {
      updateData.cpa = computedCpa(
        body.cost !== undefined ? body.cost : currentRecord?.cost,
        body.activations !== undefined ? body.activations : currentRecord?.activations
      );
    }
    if (body.ctr !== undefined) updateData.ctr = toNumberOrNull(body.ctr);
    if (body.cvr !== undefined) updateData.cvr = toNumberOrNull(body.cvr);
    if (body.cpm !== undefined) updateData.cpm = toNumberOrNull(body.cpm);
    if (body.retention_day1 !== undefined) updateData.retention_day1 = toNumberOrNull(body.retention_day1);
    if (body.retention_day7 !== undefined) updateData.retention_day7 = toNumberOrNull(body.retention_day7);

    let updateQuery = supabase
      .from('daily_records')
      .update(updateData)
      .eq('id', id);

    if (session.role === 'agent') {
      updateQuery = updateQuery.eq('agent_id', session.agentId!);
    }

    const { data, error } = await updateQuery.select().single();

    if (error) throw error;

    await recalculateAlertsForRecordIds(supabase, [id]);
    await pruneSupabaseBusinessData(supabase);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/records/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update record' }, { status: 500 });
  }
}

// DELETE /api/records/[id] - Delete a record
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!hasSupabaseConfig()) {
      await mutateLocalDb((db) => {
        const record = db.daily_records.find((item) => item.id === id);
        if (!record) return;
        if (session.role === 'agent' && (record.agent_id !== session.agentId || record.product_id !== session.productId)) {
          throw new Error('Forbidden');
        }
        cascadeDeleteRecords(db, (item) => item.id === id);
      });

      return NextResponse.json({ success: true });
    }

    const supabase = createServerSupabase();

    // Agents can only delete their own records
    if (session.role === 'agent') {
      const isOwner = await verifyRecordOwnership(supabase, id, session.agentId!);
      if (!isOwner) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { error } = await supabase
      .from('daily_records')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/records/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete record' }, { status: 500 });
  }
}
