'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, InputNumber, Select, Space, Table, Modal, Form,
  DatePicker, Typography, Progress, Tag, Popconfirm, message, Empty,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, UserAddOutlined, EditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Channel, Agent, ChannelBudget, AgentChannelAllocation } from '@/types/database';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface BudgetWithAllocations extends ChannelBudget {
  allocations: AgentChannelAllocation[];
  totalAllocated: number;
}

export default function BudgetManager() {
  const [budgets, setBudgets] = useState<BudgetWithAllocations[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetEditModalOpen, setBudgetEditModalOpen] = useState(false);
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [currentBudgetId, setCurrentBudgetId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<BudgetWithAllocations | null>(null);
  const [budgetForm] = Form.useForm();
  const [budgetEditForm] = Form.useForm();
  const [allocForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetRes, channelRes, agentRes] = await Promise.all([
        fetch('/api/budgets').then((r) => r.json()),
        fetch('/api/channels').then((r) => r.json()),
        fetch('/api/agents?active=false').then((r) => r.json()),
      ]);

      if (channelRes.success) setChannels(channelRes.data);
      if (agentRes.success) setAgents(agentRes.data);

      if (budgetRes.success) {
        // Fetch allocations for each budget
        const budgetsWithAlloc: BudgetWithAllocations[] = [];
        for (const budget of budgetRes.data) {
          const allocRes = await fetch(`/api/allocations?channelBudgetId=${budget.id}`).then((r) => r.json());
          const allocations = allocRes.success ? allocRes.data : [];
          const totalAllocated = allocations.reduce(
            (sum: number, a: AgentChannelAllocation) => sum + Number(a.spending_cap || 0),
            0
          );
          budgetsWithAlloc.push({ ...budget, allocations, totalAllocated });
        }
        setBudgets(budgetsWithAlloc);
      }
    } catch {
      messageApi.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Create channel budget
  const handleCreateBudget = async () => {
    try {
      const values = await budgetForm.validateFields();
      const [start, end] = values.period;
      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: values.channel_id,
          budget_amount: values.budget_amount,
          period_start: start.format('YYYY-MM-DD'),
          period_end: end.format('YYYY-MM-DD'),
        }),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success('渠道预算已创建');
        setBudgetModalOpen(false);
        budgetForm.resetFields();
        fetchData();
      } else {
        messageApi.error(data.error || '创建失败');
      }
    } catch {
      // Validation
    }
  };

  const handleOpenBudgetEdit = (budget: BudgetWithAllocations) => {
    setEditingBudget(budget);
    budgetEditForm.setFieldsValue({
      budget_amount: Number(budget.budget_amount),
      period: [dayjs(budget.period_start), dayjs(budget.period_end)],
    });
    setBudgetEditModalOpen(true);
  };

  const handleUpdateBudget = async () => {
    if (!editingBudget) {
      return;
    }

    try {
      const values = await budgetEditForm.validateFields();
      const [start, end] = values.period;

      const res = await fetch(`/api/budgets/${editingBudget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget_amount: values.budget_amount,
          period_start: start.format('YYYY-MM-DD'),
          period_end: end.format('YYYY-MM-DD'),
        }),
      });
      const data = await res.json();

      if (data.success) {
        messageApi.success('渠道预算已更新');
        setBudgetEditModalOpen(false);
        setEditingBudget(null);
        budgetEditForm.resetFields();
        fetchData();
      } else {
        messageApi.error(data.error || '更新失败');
      }
    } catch {
      // Validation
    }
  };

  // Delete channel budget
  const handleDeleteBudget = async (id: string) => {
    const res = await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已删除');
      fetchData();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  // Add allocation to a budget
  const handleAddAllocation = async () => {
    try {
      const values = await allocForm.validateFields();
      const res = await fetch('/api/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_budget_id: currentBudgetId,
          agent_id: values.agent_id,
          spending_cap: values.spending_cap,
          activation_floor: values.activation_floor || 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        messageApi.success('分配已添加');
        setAllocModalOpen(false);
        allocForm.resetFields();
        fetchData();
      } else {
        messageApi.error(data.error || '添加失败');
      }
    } catch {
      // Validation
    }
  };

  // Delete allocation
  const handleDeleteAllocation = async (id: string) => {
    const res = await fetch(`/api/allocations/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已删除');
      fetchData();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  // Update allocation inline
  const handleUpdateAllocation = async (id: string, field: string, value: number) => {
    const res = await fetch(`/api/allocations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已更新');
      fetchData();
    } else {
      messageApi.error(data.error || '更新失败');
    }
  };

  const allocColumns = [
    {
      title: '代理',
      dataIndex: 'agent_name',
      key: 'agent_name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '消耗上限 (元)',
      dataIndex: 'spending_cap',
      key: 'spending_cap',
      width: 180,
      render: (value: number, record: AgentChannelAllocation) => (
        <InputNumber
          defaultValue={Number(value)}
          min={0}
          precision={2}
          style={{ width: 150 }}
          onBlur={(e) => {
            const newVal = parseFloat(e.target.value);
            if (!isNaN(newVal) && newVal !== Number(value)) {
              handleUpdateAllocation(record.id, 'spending_cap', newVal);
            }
          }}
        />
      ),
    },
    {
      title: '激活目标下限',
      dataIndex: 'activation_floor',
      key: 'activation_floor',
      width: 160,
      render: (value: number, record: AgentChannelAllocation) => (
        <InputNumber
          defaultValue={value}
          min={0}
          precision={0}
          style={{ width: 120 }}
          onBlur={(e) => {
            const newVal = parseInt(e.target.value);
            if (!isNaN(newVal) && newVal !== value) {
              handleUpdateAllocation(record.id, 'activation_floor', newVal);
            }
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      render: (_: unknown, record: AgentChannelAllocation) => (
        <Popconfirm
          title="确认删除该分配？"
          onConfirm={() => handleDeleteAllocation(record.id)}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title level={5} style={{ margin: 0 }}>渠道预算与代理分配</Title>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setBudgetModalOpen(true)}>
                新增渠道预算
              </Button>
            </Space>
          </div>
        </Card>

        {/* Budget Cards */}
        {loading ? (
          <Card loading />
        ) : budgets.length === 0 ? (
          <Card>
            <Empty description="暂无渠道预算，点击「新增渠道预算」开始配置" />
          </Card>
        ) : (
          budgets.map((budget) => {
            const percent = budget.budget_amount > 0
              ? Math.round((budget.totalAllocated / Number(budget.budget_amount)) * 100)
              : 0;
            const remaining = Number(budget.budget_amount) - budget.totalAllocated;

            return (
              <Card
                key={budget.id}
                title={
                  <Space>
                    <Text strong style={{ fontSize: 16 }}>{budget.channel_name}</Text>
                    <Tag color="blue">
                      {budget.period_start} ~ {budget.period_end}
                    </Tag>
                  </Space>
                }
                extra={
                  <Space>
                    <Text>总预算: <Text strong>¥{Number(budget.budget_amount).toLocaleString()}</Text></Text>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => handleOpenBudgetEdit(budget)}
                    >
                      编辑预算
                    </Button>
                    <Button
                      size="small"
                      icon={<UserAddOutlined />}
                      onClick={() => {
                        setCurrentBudgetId(budget.id);
                        allocForm.resetFields();
                        setAllocModalOpen(true);
                      }}
                    >
                      分配代理
                    </Button>
                    <Popconfirm
                      title="确认删除该渠道预算？所有相关分配也将被删除。"
                      onConfirm={() => handleDeleteBudget(budget.id)}
                      okText="确认"
                      cancelText="取消"
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                }
              >
                {/* Utilization Bar */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text type="secondary">
                      已分配: ¥{budget.totalAllocated.toLocaleString()}
                    </Text>
                    <Text type="secondary">
                      剩余: ¥{remaining.toLocaleString()}
                    </Text>
                  </div>
                  <Progress
                    percent={percent}
                    status={percent > 100 ? 'exception' : 'active'}
                    format={(p) => `${p}%`}
                  />
                </div>

                {/* Allocations Table */}
                <Table
                  dataSource={budget.allocations}
                  columns={allocColumns}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: '暂无代理分配' }}
                />
              </Card>
            );
          })
        )}
      </Space>

      {/* New Budget Modal */}
      <Modal
        title="新增渠道预算"
        open={budgetModalOpen}
        onOk={handleCreateBudget}
        onCancel={() => { setBudgetModalOpen(false); budgetForm.resetFields(); }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={budgetForm} layout="vertical">
          <Form.Item name="channel_id" label="渠道" rules={[{ required: true, message: '请选择渠道' }]}>
            <Select
              placeholder="选择渠道"
              options={channels.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item name="budget_amount" label="预算金额 (元)" rules={[{ required: true, message: '请输入预算金额' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="输入总预算" />
          </Form.Item>
          <Form.Item name="period" label="预算周期" rules={[{ required: true, message: '请选择周期' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingBudget ? `编辑 ${editingBudget.channel_name} 渠道预算` : '编辑渠道预算'}
        open={budgetEditModalOpen}
        onOk={handleUpdateBudget}
        onCancel={() => {
          setBudgetEditModalOpen(false);
          setEditingBudget(null);
          budgetEditForm.resetFields();
        }}
        okText="保存"
        cancelText="取消"
      >
        <Form form={budgetEditForm} layout="vertical">
          <Form.Item label="渠道">
            <Text>{editingBudget?.channel_name || '-'}</Text>
          </Form.Item>
          <Form.Item name="budget_amount" label="预算金额 (元)" rules={[{ required: true, message: '请输入预算金额' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="输入总预算" />
          </Form.Item>
          <Form.Item name="period" label="预算周期" rules={[{ required: true, message: '请选择周期' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* New Allocation Modal */}
      <Modal
        title="分配代理"
        open={allocModalOpen}
        onOk={handleAddAllocation}
        onCancel={() => { setAllocModalOpen(false); allocForm.resetFields(); }}
        okText="添加"
        cancelText="取消"
      >
        <Form form={allocForm} layout="vertical">
          <Form.Item name="agent_id" label="代理" rules={[{ required: true, message: '请选择代理' }]}>
            <Select
              placeholder="选择代理"
              options={agents.filter((a) => a.is_active).map((a) => ({ label: a.name, value: a.id }))}
            />
          </Form.Item>
          <Form.Item name="spending_cap" label="消耗上限 (元)" rules={[{ required: true, message: '请输入消耗上限' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="该代理在此渠道的消耗上限" />
          </Form.Item>
          <Form.Item name="activation_floor" label="激活目标下限">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="最低激活数目标（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
