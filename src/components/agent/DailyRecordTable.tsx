'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import type { Session } from '@/types/auth';
import { useResizableColumns } from '@/components/common/useResizableColumns';

const { Title, Paragraph, Text } = Typography;

interface EditableRow {
  key: string;
  id?: string;
  record_date: string;
  creative_type: string;
  cost: number;
  activations: number;
  cpa: number | null;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  target_cpa?: number | null;
  target_retention_day1?: number | null;
  target_retention_day7?: number | null;
  activation_cap?: number | null;
}

function normalizeRows(rows: Record<string, unknown>[]): EditableRow[] {
  return rows.map((record) => ({
    key: String(record.id),
    id: String(record.id),
    record_date: String(record.record_date),
    creative_type: String(record.creative_type || ''),
    cost: Number(record.cost || 0),
    activations: Number(record.activations || 0),
    cpa: record.cpa == null ? null : Number(record.cpa),
    ctr: record.ctr == null ? null : Number(record.ctr),
    cvr: record.cvr == null ? null : Number(record.cvr),
    cpm: record.cpm == null ? null : Number(record.cpm),
    retention_day1: record.retention_day1 == null ? null : Number(record.retention_day1),
    retention_day7: record.retention_day7 == null ? null : Number(record.retention_day7),
    target_cpa: record.target_cpa == null ? null : Number(record.target_cpa),
    target_retention_day1: record.target_retention_day1 == null ? null : Number(record.target_retention_day1),
    target_retention_day7: record.target_retention_day7 == null ? null : Number(record.target_retention_day7),
    activation_cap: record.activation_cap == null ? null : Number(record.activation_cap),
  }));
}

function computedCpa(row: EditableRow) {
  return row.activations > 0 ? row.cost / row.activations : null;
}

export default function DailyRecordTable() {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedDate, setSelectedDate] = useState(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
  const [draftRows, setDraftRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchSession = useCallback(async () => {
    const response = await fetch('/api/auth/me');
    const payload = await response.json();
    if (payload.success) {
      setSession(payload.data);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/records?dateFrom=${selectedDate}&dateTo=${selectedDate}`);
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || '加载失败');
      }
      setDraftRows(normalizeRows(payload.data || []));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载填报数据失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi, selectedDate]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const firstTarget = useMemo(
    () => draftRows.find((row) => row.target_cpa || row.target_retention_day1 || row.target_retention_day7),
    [draftRows]
  );

  const handleAddRow = () => {
    setDraftRows((prev) => [...prev, {
      key: `new-${Date.now()}`,
      record_date: selectedDate,
      creative_type: '',
      cost: 0,
      activations: 0,
      cpa: null,
      ctr: null,
      cvr: null,
      cpm: null,
      retention_day1: null,
      retention_day7: null,
    }]);
  };

  const updateRow = (key: string, field: keyof EditableRow, value: string | number | null) => {
    setDraftRows((prev) => prev.map((row) => row.key === key ? { ...row, [field]: value } : row));
  };

  const handleSave = async () => {
    const rowsToSave = draftRows.filter((row) => row.creative_type.trim());
    if (rowsToSave.length !== draftRows.length) {
      messageApi.warning('体裁不能为空，空行不会保存');
    }
    if (rowsToSave.length === 0) return;

    setSaving(true);
    try {
      const response = await fetch('/api/records/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: rowsToSave.map((row) => ({
            id: row.id,
            record_date: selectedDate,
            creative_type: row.creative_type.trim(),
            cost: row.cost,
            activations: row.activations,
            ctr: row.ctr,
            cvr: row.cvr,
            cpm: row.cpm,
            retention_day1: row.retention_day1,
            retention_day7: row.retention_day7,
          })),
        }),
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.message || payload.error || '保存失败');
      }
      messageApi.success(payload.message || '保存成功');
      fetchRecords();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: EditableRow) => {
    if (!row.id) {
      setDraftRows((prev) => prev.filter((item) => item.key !== row.key));
      return;
    }

    const response = await fetch(`/api/records/${row.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('已删除');
      fetchRecords();
    } else {
      messageApi.error(payload.error || '删除失败');
    }
  };

  const columns = [
    {
      title: '体裁',
      dataIndex: 'creative_type',
      key: 'creative_type',
      width: 160,
      fixed: 'left' as const,
      render: (value: string, row: EditableRow) => (
        <Input
          value={value}
          placeholder="如短剧/小说/工具"
          onChange={(event) => updateRow(row.key, 'creative_type', event.target.value)}
        />
      ),
    },
    {
      title: '消耗',
      dataIndex: 'cost',
      key: 'cost',
      width: 130,
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} precision={2} style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'cost', next || 0)} />
      ),
    },
    {
      title: '激活数',
      dataIndex: 'activations',
      key: 'activations',
      width: 120,
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} precision={0} style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'activations', next || 0)} />
      ),
    },
    {
      title: 'CPA',
      dataIndex: 'cpa',
      key: 'cpa',
      width: 120,
      render: (_: unknown, row: EditableRow) => {
        const value = computedCpa(row);
        return value == null ? <Text type="secondary">-</Text> : <Text>{value.toFixed(2)}</Text>;
      },
    },
    {
      title: 'CTR',
      dataIndex: 'ctr',
      key: 'ctr',
      width: 110,
      render: (value: number | null, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'ctr', next)} />
      ),
    },
    {
      title: 'CVR',
      dataIndex: 'cvr',
      key: 'cvr',
      width: 110,
      render: (value: number | null, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'cvr', next)} />
      ),
    },
    {
      title: 'CPM',
      dataIndex: 'cpm',
      key: 'cpm',
      width: 120,
      render: (value: number | null, row: EditableRow) => (
        <InputNumber value={value} min={0} precision={2} style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'cpm', next)} />
      ),
    },
    {
      title: '次留(T-2)',
      dataIndex: 'retention_day1',
      key: 'retention_day1',
      width: 130,
      render: (value: number | null, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'retention_day1', next)} />
      ),
    },
    {
      title: '7留(T-8)',
      dataIndex: 'retention_day7',
      key: 'retention_day7',
      width: 130,
      render: (value: number | null, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} onChange={(next) => updateRow(row.key, 'retention_day7', next)} />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      fixed: 'right' as const,
      render: (_: unknown, row: EditableRow) => (
        <Popconfirm title="删除该行？" onConfirm={() => handleDelete(row)}>
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];
  const resizableColumns = useResizableColumns('agent-record-table-columns', columns);

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <Tag color="blue">代理端</Tag>
          <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>T-1 投放数据填报</Title>
          <Paragraph className="hero-text">
            渠道和代理商由账号自动绑定。按体裁新增多行后提交，系统会立即重算站内告警。
          </Paragraph>
          <div className="badge-row" style={{ marginTop: 16 }}>
            <Tag>产品：{session?.productName || '-'}</Tag>
            <Tag>渠道：{session?.channelName || '-'}</Tag>
            <Tag>代理商：{session?.agentName || '-'}</Tag>
          </div>
        </Card>

        {firstTarget && (
          <Alert
            type="info"
            showIcon
            title="当前已匹配考核指标"
            description={`CPA ${firstTarget.target_cpa ?? '-'}，次留 ${firstTarget.target_retention_day1 ?? '-'}%，7留 ${firstTarget.target_retention_day7 ?? '-'}%，激活上限 ${firstTarget.activation_cap ?? '-'}。`}
          />
        )}

        <Card className="section-card">
          <div className="hero-row">
            <Space wrap>
              <DatePicker value={dayjs(selectedDate)} allowClear={false} onChange={(value) => value && setSelectedDate(value.format('YYYY-MM-DD'))} />
              <Button icon={<PlusOutlined />} onClick={handleAddRow}>新增体裁行</Button>
              <Button icon={<ReloadOutlined />} onClick={fetchRecords}>刷新</Button>
            </Space>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              提交
            </Button>
          </div>
        </Card>

        <Card className="section-card" title="当日填报表">
          <Table
            rowKey="key"
            loading={loading}
            dataSource={draftRows}
            columns={resizableColumns}
            pagination={false}
            scroll={{ x: 1320 }}
            locale={{ emptyText: '当日暂无数据，点击“新增体裁行”开始填报' }}
          />
        </Card>
      </div>
    </>
  );
}
