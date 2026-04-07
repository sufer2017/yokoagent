'use client';

import React, { startTransition, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useMockApp } from '@/lib/mock/store';

const { Title, Paragraph, Text } = Typography;

interface EditableRow {
  key: string;
  date: string;
  channelId: string;
  projectId: string;
  cost: number;
  activations: number;
  retentionDay1: number;
  retentionDay7: number;
}

export default function DailyRecordTable() {
  const { state, latestPlan, latestStrategy, addAgentRecord } = useMockApp();
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [draftRows, setDraftRows] = useState<EditableRow[]>([]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          const agent = state.agents.find((item) => item.name === data.data.agentName);
          setSessionAgentId(agent?.id || null);
        }
      });
  }, [state.agents]);

  const agentPlan = useMemo(
    () => latestPlan?.agentAllocations.find((item) => item.agentId === sessionAgentId) || null,
    [latestPlan?.agentAllocations, sessionAgentId]
  );
  const agentRecords = useMemo(
    () => state.records.filter((record) => record.agentId === sessionAgentId && record.date === selectedDate),
    [selectedDate, sessionAgentId, state.records]
  );

  useEffect(() => {
    startTransition(() => {
      setDraftRows(agentRecords.map((record) => ({
        key: record.id,
        date: record.date,
        channelId: record.channelId,
        projectId: record.projectId,
        cost: record.cost,
        activations: record.activations,
        retentionDay1: record.retentionDay1,
        retentionDay7: record.retentionDay7,
      })));
    });
  }, [agentRecords]);

  const handleAddRow = () => {
    setDraftRows((prev) => [...prev, {
      key: `new-${Date.now()}`,
      date: selectedDate,
      channelId: state.channels.find((channel) => channel.is_active)?.id || '',
      projectId: state.projects.find((project) => project.is_active)?.id || '',
      cost: 0,
      activations: 0,
      retentionDay1: latestStrategy.minRetentionDay1,
      retentionDay7: latestStrategy.minRetentionDay7,
    }]);
  };

  const updateRow = (key: string, field: keyof EditableRow, value: string | number) => {
    setDraftRows((prev) => prev.map((row) => row.key === key ? { ...row, [field]: value } : row));
  };

  const handleSave = () => {
    if (!sessionAgentId) return;
    draftRows.forEach((row) => {
      addAgentRecord({
        date: row.date,
        channelId: row.channelId,
        agentId: sessionAgentId,
        projectId: row.projectId,
        cost: row.cost,
        activations: row.activations,
        retentionDay1: row.retentionDay1,
        retentionDay7: row.retentionDay7,
      });
    });
  };

  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 140,
      render: (value: string, row: EditableRow) => (
        <DatePicker
          value={dayjs(value)}
          allowClear={false}
          onChange={(next) => next && updateRow(row.key, 'date', next.format('YYYY-MM-DD'))}
        />
      ),
    },
    {
      title: '渠道',
      dataIndex: 'channelId',
      key: 'channelId',
      width: 140,
      render: (value: string, row: EditableRow) => (
        <Select
          value={value}
          style={{ width: '100%' }}
          onChange={(next) => updateRow(row.key, 'channelId', next)}
          options={state.channels.filter((channel) => channel.is_active).map((channel) => ({ value: channel.id, label: channel.name }))}
        />
      ),
    },
    {
      title: '项目',
      dataIndex: 'projectId',
      key: 'projectId',
      width: 140,
      render: (value: string, row: EditableRow) => (
        <Select
          value={value}
          style={{ width: '100%' }}
          onChange={(next) => updateRow(row.key, 'projectId', next)}
          options={state.projects.filter((project) => project.is_active).map((project) => ({ value: project.id, label: project.name }))}
        />
      ),
    },
    {
      title: '消耗',
      dataIndex: 'cost',
      key: 'cost',
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} precision={2} onChange={(next) => updateRow(row.key, 'cost', next || 0)} />
      ),
    },
    {
      title: '激活数',
      dataIndex: 'activations',
      key: 'activations',
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} precision={0} onChange={(next) => updateRow(row.key, 'activations', next || 0)} />
      ),
    },
    {
      title: '激活成本',
      key: 'activationCost',
      render: (_: unknown, row: EditableRow) => (
        <Text>{row.activations > 0 ? `¥${(row.cost / row.activations).toFixed(2)}` : '-'}</Text>
      ),
    },
    {
      title: '次留率',
      dataIndex: 'retentionDay1',
      key: 'retentionDay1',
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={1} onChange={(next) => updateRow(row.key, 'retentionDay1', next || 0)} />
      ),
    },
    {
      title: '7留率',
      dataIndex: 'retentionDay7',
      key: 'retentionDay7',
      render: (value: number, row: EditableRow) => (
        <InputNumber value={value} min={0} max={100} precision={1} onChange={(next) => updateRow(row.key, 'retentionDay7', next || 0)} />
      ),
    },
  ];

  return (
    <div className="console-stack">
      <Card className="hero-card">
        <Tag color="blue">代理端</Tag>
        <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>本周目标与数据填报</Title>
        <Paragraph className="hero-text">
          你只需要专注两件事：按天如实填报数据，以及围绕本周目标去修正自己的渠道表现。
        </Paragraph>
      </Card>

      {agentPlan && (
        <Alert
          type="info"
          showIcon
          message={`本周分配预算 ¥${agentPlan.budgetAmount.toLocaleString()}，渠道内排名第 ${agentPlan.rank}`}
          description={`${agentPlan.rationale} 当前目标次留率 ${latestStrategy.minRetentionDay1}% ，7留率 ${latestStrategy.minRetentionDay7}%。`}
        />
      )}

      <Card className="section-card">
        <div className="hero-row">
          <Space>
            <DatePicker value={dayjs(selectedDate)} allowClear={false} onChange={(value) => value && setSelectedDate(value.format('YYYY-MM-DD'))} />
            <Button icon={<PlusOutlined />} onClick={handleAddRow}>新增一行</Button>
          </Space>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存当日填报</Button>
        </div>
      </Card>

      <Card className="section-card" title="当日填报表">
        <Table
          rowKey="key"
          dataSource={draftRows}
          columns={columns}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  );
}
