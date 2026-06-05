import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { businessDataCutoff, pruneSupabaseBusinessData } from '@/lib/admin/retention';
import { defaultBusinessAnchorDate } from '@/lib/admin/dates';
import { mutateLocalDb, pruneOldBusinessData } from '@/lib/local-db/store';

function authorizedByCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (secret) return auth === `Bearer ${secret}`;
  return Boolean(process.env.VERCEL);
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (session?.role !== 'admin' && !authorizedByCron(request)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const anchorDate = defaultBusinessAnchorDate();
    const cutoff = businessDataCutoff(anchorDate);

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb((db) => {
        const beforeRecords = db.daily_records.length;
        const beforeAlerts = db.alert_results.length;
        pruneOldBusinessData(db, anchorDate);
        return {
          cutoff,
          deleted_daily_records: beforeRecords - db.daily_records.length,
          deleted_alert_results: beforeAlerts - db.alert_results.length,
        };
      });

      return NextResponse.json({ success: true, data: result });
    }

    const data = await pruneSupabaseBusinessData(createServerSupabase(), anchorDate);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/retention error:', error);
    return NextResponse.json({ success: false, error: 'Failed to prune old data' }, { status: 500 });
  }
}
