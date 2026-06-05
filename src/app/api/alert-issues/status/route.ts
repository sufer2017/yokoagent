import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, newId, nowIso } from '@/lib/local-db/store';
import type { AlertStatus } from '@/types/database';

function isAlertStatus(value: unknown): value is AlertStatus {
  return value === 'open' || value === 'acknowledged' || value === 'resolved';
}

function isIssueKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_]+:(dod|wow|target_deviation)$/.test(value);
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const alertId = typeof body.alertId === 'string' ? body.alertId : '';
    const issueKey = body.issueKey;
    const status = body.status;

    if (!alertId || !isIssueKey(issueKey) || !isAlertStatus(status)) {
      return NextResponse.json({ success: false, error: '无效处理状态参数' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const alert = db.alert_results.find((item) => item.id === alertId);
        if (!alert) throw new Error('Alert not found');

        const timestamp = nowIso();
        const existing = db.alert_issue_statuses.find((item) => (
          item.alert_result_id === alertId && item.issue_key === issueKey
        ));
        if (existing) {
          existing.status = status;
          existing.updated_at = timestamp;
          return existing;
        }

        const next = {
          id: newId(),
          alert_result_id: alertId,
          issue_key: issueKey,
          status,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.alert_issue_statuses.push(next);
        return next;
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('alert_issue_statuses')
      .upsert(
        { alert_result_id: alertId, issue_key: issueKey, status },
        { onConflict: 'alert_result_id,issue_key' }
      )
      .select('id, alert_result_id, issue_key, status, created_at, updated_at')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/alert-issues/status error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update alert issue status' }, { status: 500 });
  }
}
