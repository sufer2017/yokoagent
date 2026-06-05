import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { decorateAlert, readLocalDb } from '@/lib/local-db/store';

function toNumber(value: unknown) {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

interface DashboardRecord {
  id: string;
  record_date: string;
  channel_name: string;
  agent_name: string;
  creative_type: string;
  cost: number;
  activations: number;
  cpa: number;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
}

function relationName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value as { name?: string } | null;
  return relation?.name || '';
}

function summarizeByChannel(records: DashboardRecord[]) {
  const grouped = new Map<string, DashboardRecord[]>();
  for (const record of records) {
    grouped.set(record.channel_name, [...(grouped.get(record.channel_name) || []), record]);
  }

  return Array.from(grouped.entries()).map(([channelName, rows]) => {
    const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
    const totalActivations = rows.reduce((sum, row) => sum + row.activations, 0);
    const uniqueAgents = new Set(rows.map((row) => row.agent_name));
    const day1Rows = rows.filter((row) => row.retention_day1 != null);
    const day7Rows = rows.filter((row) => row.retention_day7 != null);

    return {
      channel_name: channelName,
      agent_count: uniqueAgents.size,
      record_count: rows.length,
      total_cost: Number(totalCost.toFixed(2)),
      total_activations: totalActivations,
      average_cpa: totalActivations > 0 ? Number((totalCost / totalActivations).toFixed(2)) : 0,
      average_retention_day1: day1Rows.length > 0
        ? Number((day1Rows.reduce((sum, row) => sum + (row.retention_day1 || 0), 0) / day1Rows.length).toFixed(2))
        : 0,
      average_retention_day7: day7Rows.length > 0
        ? Number((day7Rows.reduce((sum, row) => sum + (row.retention_day7 || 0), 0) / day7Rows.length).toFixed(2))
        : 0,
    };
  }).sort((left, right) => right.total_cost - left.total_cost);
}

function summarizeByAgent(records: DashboardRecord[]) {
  const grouped = new Map<string, DashboardRecord[]>();
  for (const record of records) {
    const key = `${record.channel_name}:${record.agent_name}`;
    grouped.set(key, [...(grouped.get(key) || []), record]);
  }

  return Array.from(grouped.values()).map((rows) => {
    const first = rows[0];
    const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
    const totalActivations = rows.reduce((sum, row) => sum + row.activations, 0);
    const creativeTypes = new Set(rows.map((row) => row.creative_type));
    const day1Rows = rows.filter((row) => row.retention_day1 != null);
    const day7Rows = rows.filter((row) => row.retention_day7 != null);

    return {
      key: `${first.channel_name}:${first.agent_name}`,
      channel_name: first.channel_name,
      agent_name: first.agent_name,
      creative_count: creativeTypes.size,
      record_count: rows.length,
      total_cost: Number(totalCost.toFixed(2)),
      total_activations: totalActivations,
      average_cpa: totalActivations > 0 ? Number((totalCost / totalActivations).toFixed(2)) : 0,
      average_retention_day1: day1Rows.length > 0
        ? Number((day1Rows.reduce((sum, row) => sum + (row.retention_day1 || 0), 0) / day1Rows.length).toFixed(2))
        : 0,
      average_retention_day7: day7Rows.length > 0
        ? Number((day7Rows.reduce((sum, row) => sum + (row.retention_day7 || 0), 0) / day7Rows.length).toFixed(2))
        : 0,
    };
  }).sort((left, right) => right.total_cost - left.total_cost);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const focusDate = searchParams.get('date') || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const startDate = dayjs(focusDate).subtract(6, 'day').format('YYYY-MM-DD');

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const latestTargetByAgent = new Map<string, { is_running: boolean }>();
      const sortedTargets = [...db.target_changes]
        .filter((target) => target.effective_date <= focusDate)
        .sort((left, right) => right.effective_date.localeCompare(left.effective_date));

      for (const target of sortedTargets) {
        const key = `${target.agent_id}:${target.channel_id}`;
        if (!latestTargetByAgent.has(key)) {
          latestTargetByAgent.set(key, { is_running: target.is_running });
        }
      }

      const expectedAgents = db.agents.filter((agent) => (
        agent.is_active &&
        latestTargetByAgent.get(`${agent.id}:${agent.channel_id}`)?.is_running
      ));
      const focusRecords = db.daily_records.filter((record) => record.record_date === focusDate);
      const filledAgentIds = new Set(focusRecords.map((record) => record.agent_id));
      const filledAgents = expectedAgents.filter((agent) => filledAgentIds.has(agent.id));
      const missingAgents = expectedAgents
        .filter((agent) => !filledAgentIds.has(agent.id))
        .map((agent) => ({
          agent_id: agent.id,
          agent_name: agent.name,
          channel_id: agent.channel_id,
          channel_name: db.channels.find((channel) => channel.id === agent.channel_id)?.name || '',
        }));

      const records: DashboardRecord[] = focusRecords.map((record) => ({
        id: record.id,
        record_date: record.record_date,
        channel_name: db.channels.find((channel) => channel.id === record.channel_id)?.name || '',
        agent_name: db.agents.find((agent) => agent.id === record.agent_id)?.name || '',
        creative_type: record.creative_type,
        cost: toNumber(record.cost),
        activations: toNumber(record.activations),
        cpa: toNumber(record.cpa),
        ctr: record.ctr,
        cvr: record.cvr,
        cpm: record.cpm,
        retention_day1: record.retention_day1,
        retention_day7: record.retention_day7,
      }));

      const totalCost = records.reduce((sum, record) => sum + toNumber(record.cost), 0);
      const totalActivations = records.reduce((sum, record) => sum + toNumber(record.activations), 0);
      const averageCpa = totalActivations > 0 ? totalCost / totalActivations : 0;
      const averageDay1 = records.length > 0
        ? records.reduce((sum, record) => sum + toNumber(record.retention_day1), 0) / records.length
        : 0;
      const averageDay7 = records.length > 0
        ? records.reduce((sum, record) => sum + toNumber(record.retention_day7), 0) / records.length
        : 0;
      const alertRows = db.alert_results
        .filter((alert) => alert.record_date === focusDate && alert.has_alert)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map((alert) => decorateAlert(db, alert));
      const trend = Array.from({ length: 7 }, (_, index) => {
        const date = dayjs(startDate).add(index, 'day').format('YYYY-MM-DD');
        const count = db.alert_results.filter((alert) => alert.record_date === date && alert.has_alert).length;
        return { date, alert_count: count };
      });

      return NextResponse.json({
        success: true,
        data: {
          focusDate,
          summary: {
            expected_agents: expectedAgents.length,
            filled_agents: filledAgents.length,
            missing_agents: missingAgents.length,
            record_count: records.length,
            alert_count: alertRows.length,
            open_alert_count: alertRows.filter((alert) => alert.status === 'open').length,
            total_cost: Number(totalCost.toFixed(2)),
            total_activations: totalActivations,
            average_cpa: Number(averageCpa.toFixed(2)),
            average_retention_day1: Number(averageDay1.toFixed(2)),
            average_retention_day7: Number(averageDay7.toFixed(2)),
          },
          missingAgents,
          records,
          channelSummary: summarizeByChannel(records),
          agentSummary: summarizeByAgent(records),
          recentAlerts: alertRows.slice(0, 10),
          trend,
          isMock: false,
          needsDemoInit: records.length === 0 && expectedAgents.length === 0,
        },
      });
    }

    const supabase = createServerSupabase();

    const [agentsRes, targetsRes, recordsRes, alertsRes, trendRes] = await Promise.all([
      supabase
        .from('agents')
        .select('id, name, channel_id, is_active, channels(name)')
        .eq('is_active', true),
      supabase
        .from('target_changes')
        .select('agent_id, channel_id, is_running, effective_date')
        .lte('effective_date', focusDate)
        .order('effective_date', { ascending: false }),
      supabase
        .from('daily_records')
        .select('id, agent_id, channel_id, record_date, creative_type, cost, activations, cpa, ctr, cvr, cpm, retention_day1, retention_day7, agents(name), channels(name)')
        .eq('record_date', focusDate),
      supabase
        .from('alert_results')
        .select('*, agents(name), channels(name)')
        .eq('record_date', focusDate)
        .eq('has_alert', true)
        .order('updated_at', { ascending: false }),
      supabase
        .from('alert_results')
        .select('record_date, has_alert')
        .gte('record_date', startDate)
        .lte('record_date', focusDate)
        .eq('has_alert', true),
    ]);

    if (agentsRes.error) throw agentsRes.error;
    if (targetsRes.error) throw targetsRes.error;
    if (recordsRes.error) throw recordsRes.error;
    if (alertsRes.error) throw alertsRes.error;
    if (trendRes.error) throw trendRes.error;

    const latestTargetByAgent = new Map<string, { is_running: boolean }>();
    for (const target of targetsRes.data || []) {
      const key = `${target.agent_id}:${target.channel_id}`;
      if (!latestTargetByAgent.has(key)) {
        latestTargetByAgent.set(key, { is_running: Boolean(target.is_running) });
      }
    }

    const expectedAgents = (agentsRes.data || []).filter((agent) => {
      const target = latestTargetByAgent.get(`${agent.id}:${agent.channel_id}`);
      return target ? target.is_running : false;
    });

    const filledAgentIds = new Set((recordsRes.data || []).map((record) => record.agent_id as string));
    const filledAgents = expectedAgents.filter((agent) => filledAgentIds.has(agent.id));
    const missingAgents = expectedAgents
      .filter((agent) => !filledAgentIds.has(agent.id))
      .map((agent: Record<string, unknown>) => {
        const channel = Array.isArray(agent.channels) ? agent.channels[0] : agent.channels as { name?: string } | null;
        return {
          agent_id: agent.id,
          agent_name: agent.name,
          channel_id: agent.channel_id,
          channel_name: channel?.name,
        };
      });

    const records: DashboardRecord[] = (recordsRes.data || []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      record_date: String(row.record_date),
      channel_name: relationName(row.channels),
      agent_name: relationName(row.agents),
      creative_type: String(row.creative_type || ''),
      cost: toNumber(row.cost),
      activations: toNumber(row.activations),
      cpa: toNumber(row.cpa),
      ctr: row.ctr == null ? null : toNumber(row.ctr),
      cvr: row.cvr == null ? null : toNumber(row.cvr),
      cpm: row.cpm == null ? null : toNumber(row.cpm),
      retention_day1: row.retention_day1 == null ? null : toNumber(row.retention_day1),
      retention_day7: row.retention_day7 == null ? null : toNumber(row.retention_day7),
    }));

    const totalCost = records.reduce((sum, record) => sum + toNumber(record.cost), 0);
    const totalActivations = records.reduce((sum, record) => sum + toNumber(record.activations), 0);
    const averageCpa = totalActivations > 0 ? totalCost / totalActivations : 0;
    const averageDay1 = records.length > 0
      ? records.reduce((sum, record) => sum + toNumber(record.retention_day1), 0) / records.length
      : 0;
    const averageDay7 = records.length > 0
      ? records.reduce((sum, record) => sum + toNumber(record.retention_day7), 0) / records.length
      : 0;

    const trend = Array.from({ length: 7 }, (_, index) => {
      const date = dayjs(startDate).add(index, 'day').format('YYYY-MM-DD');
      const count = (trendRes.data || []).filter((item) => item.record_date === date).length;
      return { date, alert_count: count };
    });

    const alertRows: Array<Record<string, unknown>> = (alertsRes.data || []).map((row: Record<string, unknown>) => ({
      ...row,
      agent_name: relationName(row.agents),
      channel_name: relationName(row.channels),
      agents: undefined,
      channels: undefined,
    }));

    return NextResponse.json({
      success: true,
      data: {
        focusDate,
        summary: {
          expected_agents: expectedAgents.length,
          filled_agents: filledAgents.length,
          missing_agents: missingAgents.length,
          record_count: records.length,
          alert_count: alertRows.length,
          open_alert_count: alertRows.filter((alert) => alert.status === 'open').length,
          total_cost: Number(totalCost.toFixed(2)),
          total_activations: totalActivations,
          average_cpa: Number(averageCpa.toFixed(2)),
          average_retention_day1: Number(averageDay1.toFixed(2)),
          average_retention_day7: Number(averageDay7.toFixed(2)),
        },
        missingAgents,
        records,
        channelSummary: summarizeByChannel(records),
        agentSummary: summarizeByAgent(records),
        recentAlerts: alertRows.slice(0, 10),
        trend,
        isMock: false,
        needsDemoInit: records.length === 0 && expectedAgents.length === 0,
      },
    });
  } catch (error) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}
