'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Input, Switch, Space, Card, Modal, Form,
  Typography, Tag, Popconfirm, message, Divider,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { Agent, Channel, Project } from '@/types/database';

const { Title, Text } = Typography;

// =====================================================
// Reusable CRUD list for channels/projects
// =====================================================
function SimpleList({
  title,
  items,
  loading,
  onAdd,
  onDelete,
}: {
  title: string;
  items: { id: string; name: string }[];
  loading: boolean;
  onAdd: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [inputVal, setInputVal] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!inputVal.trim()) return;
    setAdding(true);
    await onAdd(inputVal.trim());
    setInputVal('');
    setAdding(false);
  };

  return (
    <Card size="small" title={title} loading={loading}>
      <Space wrap>
        {items.map((item) => (
          <Tag
            key={item.id}
            closable
            onClose={(e) => {
              e.preventDefault();
              onDelete(item.id);
            }}
            style={{ fontSize: 14, padding: '4px 8px' }}
          >
            {item.name}
          </Tag>
        ))}
      </Space>
      <Divider style={{ margin: '12px 0' }} />
      <Space>
        <Input
          placeholder={`新增${title.replace('管理', '')}`}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onPressEnter={handleAdd}
          style={{ width: 200 }}
        />
        <Button type="primary" size="small" onClick={handleAdd} loading={adding}>
          添加
        </Button>
      </Space>
    </Card>
  );
}

// =====================================================
// Main AgentPoolTable
// =====================================================
export default function AgentPoolTable() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [agRes, chRes, prRes] = await Promise.all([
        fetch('/api/agents?active=false').then((r) => r.json()),
        fetch('/api/channels').then((r) => r.json()),
        fetch('/api/projects').then((r) => r.json()),
      ]);
      if (agRes.success) setAgents(agRes.data);
      if (chRes.success) setChannels(chRes.data);
      if (prRes.success) setProjects(prRes.data);
    } catch {
      messageApi.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Agent CRUD
  const handleAddAgent = () => {
    setEditingAgent(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    form.setFieldsValue({ name: agent.name });
    setModalOpen(true);
  };

  const handleSaveAgent = async () => {
    try {
      const values = await form.validateFields();
      const url = editingAgent ? `/api/agents/${editingAgent.id}` : '/api/agents';
      const method = editingAgent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name }),
      });
      const data = await res.json();

      if (data.success) {
        messageApi.success(editingAgent ? '更新成功' : '创建成功');
        setModalOpen(false);
        fetchData();
      } else {
        messageApi.error(data.error || '操作失败');
      }
    } catch {
      // Validation failed
    }
  };

  const handleToggleActive = async (agent: Agent) => {
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !agent.is_active }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success(agent.is_active ? '已停用' : '已启用');
      fetchData();
    } else {
      messageApi.error(data.error || '操作失败');
    }
  };

  const handleDeleteAgent = async (id: string) => {
    const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('已停用');
      fetchData();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  // Channel/Project helpers
  const handleAddChannel = async (name: string) => {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success('渠道已添加');
      fetchData();
    } else {
      messageApi.error(data.error || '添加失败');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('渠道已删除');
      fetchData();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  const handleAddProject = async (name: string) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) {
      messageApi.success('项目已添加');
      fetchData();
    } else {
      messageApi.error(data.error || '添加失败');
    }
  };

  const handleDeleteProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      messageApi.success('项目已删除');
      fetchData();
    } else {
      messageApi.error(data.error || '删除失败');
    }
  };

  const agentColumns = [
    {
      title: '代理名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (isActive: boolean, record: Agent) => (
        <Switch
          checked={isActive}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={() => handleToggleActive(record)}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (val: string) => new Date(val).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Agent) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEditAgent(record)}
          />
          <Popconfirm
            title="确认停用该代理？"
            onConfirm={() => handleDeleteAgent(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Agent Table */}
        <Card
          title={<Title level={5} style={{ margin: 0 }}>代理池</Title>}
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAgent}>
                新增代理
              </Button>
            </Space>
          }
        >
          <Table
            dataSource={agents}
            columns={agentColumns}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="middle"
          />
        </Card>

        {/* Channel & Project Management */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <SimpleList
            title="渠道管理"
            items={channels}
            loading={loading}
            onAdd={handleAddChannel}
            onDelete={handleDeleteChannel}
          />
          <SimpleList
            title="项目管理"
            items={projects}
            loading={loading}
            onAdd={handleAddProject}
            onDelete={handleDeleteProject}
          />
        </div>
      </Space>

      {/* Add/Edit Agent Modal */}
      <Modal
        title={editingAgent ? '编辑代理' : '新增代理'}
        open={modalOpen}
        onOk={handleSaveAgent}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="代理名称"
            rules={[{ required: true, message: '请输入代理名称' }]}
          >
            <Input placeholder="输入代理姓名" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
