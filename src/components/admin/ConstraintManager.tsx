'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, InputNumber, Select, Input, Switch, Space, Card,
  Modal, Form, Typography, Tag, Popconfirm, message, Alert,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { Constraint } from '@/types/database';

const { Title, Text } = Typography;

const METRIC_OPTIONS = [
  { label: '激活成本', value: 'activation_cost' },
  { label: '激活数', value: 'activations' },
  { label: '次日留存率', value: 'retention_day1' },
  { label: '7日留存率', value: 'retention_day7' },
  { label: '消耗金额', value: 'cost' },
];

const OPERATOR_OPTIONS = [
  { label: '<=', value: '<=' },
  { label: '>=', value: '>=' },
  { label: '<', value: '<' },
  { label: '>', value: '>' },
  { label: '=', value: '=' },
];

export default function ConstraintManager() {
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchConstraints = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/constraints');
      const data = await res.json();
      if (data.success) setConstraints(data.data);
    } catch {
      messageApi.error('加载约束失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { fetchConstraints(); }, [fetchConstraints]);

  const hardConstraints = constraints.filter((c) => c.type === 'hard');
  const customConstraints = constraints.filter((c) => c.type === 'custom');

  // Update constraint value inline
  const handleUpdateValue = async (id: string, value: number) => {
    const res = await fetch(`/api/constraints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已更新');
      fetchConstraints();
    } else {
      messageApi.error(data.error || '更新失败');
    }
  };

  // Toggle active
  const handleToggleActive = async (constraint: Constraint) => {
    const res = await fetch(`/api/constraints/${constraint.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !constraint.is_active }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success(constraint.is_active ? '已禁用' : '已启用');
      fetchConstraints();
    }
  };

  // Add custom constraint
  const handleAddCustom = async () => {
    try {
      const values = await form.validateFields();
      const res = await fetch('/api/constraints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success('约束已创建');
        setModalOpen(false);
        form.resetFields();
        fetchConstraints();
      } else {
        messageApi.error(data.error || '创建失败');
      }
    } catch {
      // Validation failed
    }
  };

  // Delete custom constraint
  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/constraints/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已删除');
      fetchConstraints();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  const metricLabel = (metric: string) =>
    METRIC_OPTIONS.find((m) => m.value === metric)?.label || metric;

  // Hard constraints table
  const hardColumns = [
    {
      title: '约束名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '指标',
      dataIndex: 'metric',
      key: 'metric',
      render: (m: string) => <Tag>{metricLabel(m)}</Tag>,
    },
    {
      title: '运算符',
      dataIndex: 'operator',
      key: 'operator',
      width: 80,
      render: (op: string) => <Text code>{op}</Text>,
    },
    {
      title: '阈值',
      dataIndex: 'value',
      key: 'value',
      width: 200,
      render: (value: number, record: Constraint) => (
        <InputNumber
          defaultValue={value}
          min={0}
          precision={2}
          style={{ width: 150 }}
          onBlur={(e) => {
            const newVal = parseFloat(e.target.value);
            if (!isNaN(newVal) && newVal !== value) {
              handleUpdateValue(record.id, newVal);
            }
          }}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (isActive: boolean, record: Constraint) => (
        <Switch
          checked={isActive}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          onChange={() => handleToggleActive(record)}
        />
      ),
    },
  ];

  // Custom constraints table
  const customColumns = [
    ...hardColumns,
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: Constraint) => (
        <Popconfirm
          title="确认删除该约束？"
          onConfirm={() => handleDelete(record.id)}
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
        {/* Hard Constraints */}
        <Card
          title={<Title level={5} style={{ margin: 0 }}>硬性约束（固定四项）</Title>}
          extra={<Button icon={<ReloadOutlined />} onClick={fetchConstraints}>刷新</Button>}
        >
          <Alert
            message="硬性约束不可删除，只能修改阈值和启用/禁用状态"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Table
            dataSource={hardConstraints}
            columns={hardColumns}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="middle"
          />
        </Card>

        {/* Custom Constraints */}
        <Card
          title={<Title level={5} style={{ margin: 0 }}>自定义约束</Title>}
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              新增约束
            </Button>
          }
        >
          <Table
            dataSource={customConstraints}
            columns={customColumns}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无自定义约束' }}
          />
        </Card>

        {/* Optimization Goal Info */}
        <Card title={<Title level={5} style={{ margin: 0 }}>优化目标说明</Title>}>
          <Alert
            message="综合 ROI 最大化"
            description="在满足所有约束的前提下，追求：激活成本越低越好 × 激活量越高越好 × 次留率越高越好 × 7留率越高越好"
            type="success"
            showIcon
          />
        </Card>
      </Space>

      {/* Add Custom Constraint Modal */}
      <Modal
        title="新增自定义约束"
        open={modalOpen}
        onOk={handleAddCustom}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="约束名称" rules={[{ required: true, message: '请输入约束名称' }]}>
            <Input placeholder="例如：百度渠道预算上限" />
          </Form.Item>
          <Form.Item name="metric" label="指标" rules={[{ required: true, message: '请选择指标' }]}>
            <Select options={METRIC_OPTIONS} placeholder="选择约束指标" />
          </Form.Item>
          <Form.Item name="operator" label="运算符" rules={[{ required: true, message: '请选择运算符' }]}>
            <Select options={OPERATOR_OPTIONS} placeholder="选择" style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="value" label="阈值" rules={[{ required: true, message: '请输入阈值' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="输入数值" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
