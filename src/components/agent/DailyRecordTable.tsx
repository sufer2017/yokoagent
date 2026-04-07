'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, InputNumber, Select, Space, Card, Typography,
  Popconfirm, message, Spin, Tag,
} from 'antd';
import { DatePicker } from 'antd';
import {
  PlusOutlined, SaveOutlined, DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import DateNavigator from './DateNavigator';
import { computeActivationCost } from '@/lib/helpers/formatters';

const { Title, Text } = Typography;

interface Channel { id: string; name: string; }
interface Project { id: string; name: string; }

interface RecordRow {
  key: string;
  id?: string; // DB id, undefined for new rows
  record_date: string;
  channel_id: string;
  project_id: string;
  cost: number;
  activations: number;
  activation_cost: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  isNew?: boolean; // New unsaved row
  isDirty?: boolean; // Modified but not saved
}

export default function DailyRecordTable() {
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // Fetch channels and projects
  useEffect(() => {
    Promise.all([
      fetch('/api/channels').then((r) => r.json()),
      fetch('/api/projects').then((r) => r.json()),
    ]).then(([chRes, prRes]) => {
      if (chRes.success) setChannels(chRes.data);
      if (prRes.success) setProjects(prRes.data);
    });
  }, []);

  // Fetch records for selected date
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/records?dateFrom=${selectedDate}&dateTo=${selectedDate}`);
      const data = await res.json();
      if (data.success) {
        setRecords(
          data.data.map((r: Record<string, unknown>) => ({
            key: r.id as string,
            id: r.id as string,
            record_date: r.record_date as string,
            channel_id: r.channel_id as string,
            project_id: r.project_id as string,
            cost: Number(r.cost) || 0,
            activations: Number(r.activations) || 0,
            activation_cost: r.activation_cost as number | null,
            retention_day1: r.retention_day1 != null ? Number(r.retention_day1) : null,
            retention_day7: r.retention_day7 != null ? Number(r.retention_day7) : null,
            isNew: false,
            isDirty: false,
          }))
        );
      }
    } catch {
      messageApi.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, messageApi]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Add new row
  const handleAddRow = () => {
    const newRow: RecordRow = {
      key: `new_${Date.now()}`,
      record_date: selectedDate,
      channel_id: channels[0]?.id || '',
      project_id: projects[0]?.id || '',
      cost: 0,
      activations: 0,
      activation_cost: null,
      retention_day1: null,
      retention_day7: null,
      isNew: true,
      isDirty: true,
    };
    setRecords([...records, newRow]);
  };

  // Update a field in a row
  const handleFieldChange = (key: string, field: string, value: unknown) => {
    setRecords((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const updated = { ...row, [field]: value, isDirty: true };
        // Recompute activation_cost
        updated.activation_cost = computeActivationCost(updated.cost, updated.activations);
        return updated;
      })
    );
  };

  // Delete a row
  const handleDeleteRow = async (key: string) => {
    const row = records.find((r) => r.key === key);
    if (!row) return;

    if (row.id) {
      // Delete from DB
      try {
        const res = await fetch(`/api/records/${row.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) {
          messageApi.error(data.error || '删除失败');
          return;
        }
        messageApi.success('已删除');
      } catch {
        messageApi.error('删除失败');
        return;
      }
    }

    setRecords((prev) => prev.filter((r) => r.key !== key));
  };

  // Save all dirty rows
  const handleSave = async () => {
    const dirtyRows = records.filter((r) => r.isDirty);
    if (dirtyRows.length === 0) {
      messageApi.info('没有需要保存的更改');
      return;
    }

    // Validate
    for (const row of dirtyRows) {
      if (!row.channel_id) {
        messageApi.error('请选择渠道');
        return;
      }
      if (!row.project_id) {
        messageApi.error('请选择项目');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/records/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: dirtyRows.map((r) => ({
            id: r.id || undefined,
            record_date: r.record_date,
            channel_id: r.channel_id,
            project_id: r.project_id,
            cost: r.cost,
            activations: r.activations,
            retention_day1: r.retention_day1,
            retention_day7: r.retention_day7,
          })),
        }),
      });

      const data = await res.json();
      if (data.success) {
        messageApi.success(data.message || '保存成功');
        fetchRecords(); // Refresh from DB
      } else {
        messageApi.error(data.message || data.error || '保存失败');
      }
    } catch {
      messageApi.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const hasDirtyRows = records.some((r) => r.isDirty);

  const columns = [
    {
      title: '日期',
      dataIndex: 'record_date',
      key: 'record_date',
      width: 150,
      render: (value: string, record: RecordRow) => (
        <DatePicker
          value={value ? dayjs(value) : null}
          onChange={(date) => handleFieldChange(record.key, 'record_date', date?.format('YYYY-MM-DD') || selectedDate)}
          allowClear={false}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '渠道',
      dataIndex: 'channel_id',
      key: 'channel_id',
      width: 150,
      render: (value: string, record: RecordRow) => (
        <Select
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'channel_id', v)}
          style={{ width: '100%' }}
          placeholder="选择渠道"
          options={channels.map((c) => ({ label: c.name, value: c.id }))}
        />
      ),
    },
    {
      title: '项目',
      dataIndex: 'project_id',
      key: 'project_id',
      width: 150,
      render: (value: string, record: RecordRow) => (
        <Select
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'project_id', v)}
          style={{ width: '100%' }}
          placeholder="选择项目"
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
        />
      ),
    },
    {
      title: '消耗 (元)',
      dataIndex: 'cost',
      key: 'cost',
      width: 130,
      render: (value: number, record: RecordRow) => (
        <InputNumber
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'cost', v || 0)}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          placeholder="0.00"
        />
      ),
    },
    {
      title: '激活数',
      dataIndex: 'activations',
      key: 'activations',
      width: 110,
      render: (value: number, record: RecordRow) => (
        <InputNumber
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'activations', v || 0)}
          min={0}
          precision={0}
          style={{ width: '100%' }}
          placeholder="0"
        />
      ),
    },
    {
      title: '激活成本 (元)',
      dataIndex: 'activation_cost',
      key: 'activation_cost',
      width: 120,
      render: (value: number | null) => (
        <Text type={value != null ? undefined : 'secondary'}>
          {value != null ? `¥${value.toFixed(2)}` : '-'}
        </Text>
      ),
    },
    {
      title: '次留率 (%)',
      dataIndex: 'retention_day1',
      key: 'retention_day1',
      width: 110,
      render: (value: number | null, record: RecordRow) => (
        <InputNumber
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'retention_day1', v)}
          min={0}
          max={100}
          precision={2}
          style={{ width: '100%' }}
          placeholder="0.00"
        />
      ),
    },
    {
      title: '7留率 (%)',
      dataIndex: 'retention_day7',
      key: 'retention_day7',
      width: 110,
      render: (value: number | null, record: RecordRow) => (
        <InputNumber
          value={value}
          onChange={(v) => handleFieldChange(record.key, 'retention_day7', v)}
          min={0}
          max={100}
          precision={2}
          style={{ width: '100%' }}
          placeholder="0.00"
        />
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: RecordRow) => {
        if (record.isNew) return <Tag color="green">新增</Tag>;
        if (record.isDirty) return <Tag color="orange">已修改</Tag>;
        return <Tag color="default">已保存</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      render: (_: unknown, record: RecordRow) => (
        <Popconfirm
          title="确认删除这条记录？"
          onConfirm={() => handleDeleteRow(record.key)}
          okText="确认"
          cancelText="取消"
        >
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Header */}
        <Card styles={{ body: { padding: '16px 24px' } }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Space>
              <Title level={5} style={{ margin: 0 }}>每日数据</Title>
              <DateNavigator value={selectedDate} onChange={setSelectedDate} />
            </Space>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchRecords}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} onClick={handleAddRow}>
                新增一行
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
                disabled={!hasDirtyRows}
              >
                保存 {hasDirtyRows ? `(${records.filter((r) => r.isDirty).length})` : ''}
              </Button>
            </Space>
          </div>
        </Card>

        {/* Table */}
        <Card styles={{ body: { padding: 0 } }}>
          <Spin spinning={loading}>
            <Table
              dataSource={records}
              columns={columns}
              rowKey="key"
              pagination={false}
              scroll={{ x: 1240 }}
              size="middle"
              locale={{
                emptyText: (
                  <div style={{ padding: 48 }}>
                    <Text type="secondary">
                      {selectedDate} 暂无数据，点击「新增一行」开始填报
                    </Text>
                  </div>
                ),
              }}
            />
          </Spin>
        </Card>
      </Space>
    </>
  );
}
