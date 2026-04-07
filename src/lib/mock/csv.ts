import type { PerformanceRecord } from '@/types/mock';

const REQUIRED_HEADERS = [
  'date',
  'channel',
  'agent',
  'project',
  'cost',
  'activations',
  'retention_day1',
  'retention_day7',
];

export function parsePerformanceCsv(fileText: string): {
  records: Omit<PerformanceRecord, 'id' | 'channelId' | 'agentId' | 'projectId'>[];
  errors: string[];
} {
  const rows = fileText.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) {
    return { records: [], errors: ['CSV 至少需要表头和一行数据。'] };
  }

  const headers = rows[0].split(',').map((item) => item.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    return { records: [], errors: [`缺少字段：${missingHeaders.join(', ')}`] };
  }

  const records: Omit<PerformanceRecord, 'id' | 'channelId' | 'agentId' | 'projectId'>[] = [];
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  rows.slice(1).forEach((row, rowIndex) => {
    const values = row.split(',').map((item) => item.trim());
    const payload = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const line = rowIndex + 2;
    const cost = Number(payload.cost);
    const activations = Number(payload.activations);
    const retentionDay1 = Number(payload.retention_day1);
    const retentionDay7 = Number(payload.retention_day7);
    const key = `${payload.date}-${payload.channel}-${payload.agent}-${payload.project}`;

    if (seenKeys.has(key)) {
      errors.push(`第 ${line} 行与前文重复：${key}`);
      return;
    }
    seenKeys.add(key);

    if (!payload.date || !payload.channel || !payload.agent || !payload.project) {
      errors.push(`第 ${line} 行存在空字段。`);
      return;
    }
    if ([cost, activations, retentionDay1, retentionDay7].some((value) => Number.isNaN(value))) {
      errors.push(`第 ${line} 行包含非法数字。`);
      return;
    }

    records.push({
      date: payload.date,
      channelName: payload.channel,
      agentName: payload.agent,
      projectName: payload.project,
      cost,
      activations,
      activationCost: activations > 0 ? Number((cost / activations).toFixed(2)) : 0,
      retentionDay1,
      retentionDay7,
    });
  });

  return { records, errors };
}
