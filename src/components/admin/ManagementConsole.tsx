'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { Agent, Channel, Product } from '@/types/database';
import { DEMO_AGENT_CREDENTIALS, generateAgentPassword } from '@/lib/admin/passwords';
import { useResizableColumns } from '@/components/common/useResizableColumns';
import { normalizeCreativeTypes } from '@/lib/admin/creativeTypes';

const { Title, Paragraph, Text } = Typography;

type ActiveTab = 'agents' | 'channels' | 'products';

function isDemoAgent(agent: Agent) {
  return agent.name.startsWith('演示-') || DEMO_AGENT_CREDENTIALS.some((item) => item.username === agent.username);
}

export default function ManagementConsole() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('agents');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [updatingAgentIds, setUpdatingAgentIds] = useState<string[]>([]);
  const [agentForm] = Form.useForm();
  const [channelForm] = Form.useForm();
  const [productForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentRes, channelRes, productRes] = await Promise.all([
        fetch('/api/agents?active=false').then((res) => res.json()),
        fetch('/api/channels?active=false').then((res) => res.json()),
        fetch('/api/products?active=false').then((res) => res.json()),
      ]);
      if (!agentRes.success) throw new Error(agentRes.error || '代理加载失败');
      if (!channelRes.success) throw new Error(channelRes.error || '渠道加载失败');
      if (!productRes.success) throw new Error(productRes.error || '产品加载失败');
      setAgents(agentRes.data || []);
      setChannels(channelRes.data || []);
      setProducts(productRes.data || []);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const creativeTypeOptions = useMemo(() => (
    normalizeCreativeTypes([
      '短剧',
      '小游戏',
      '小说',
      '工具',
      ...agents.flatMap((agent) => agent.creative_types || []),
    ])
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
      .map((value) => ({ value, label: value }))
  ), [agents]);

  const openAgentModal = (agent?: Agent) => {
    setEditingAgent(agent || null);
    agentForm.setFieldsValue(agent ? {
      name: agent.name,
      username: agent.username,
      creative_types: normalizeCreativeTypes(agent.creative_types),
      feishu_webhook: agent.feishu_webhook || '',
      product_id: agent.product_id,
      channel_id: agent.channel_id,
      is_active: agent.is_active,
      password: '',
    } : {
      is_active: true,
      creative_types: [],
      password: generateAgentPassword(),
    });
    setAgentModalOpen(true);
  };

  const saveAgent = async () => {
    const values = await agentForm.validateFields();
    const response = await fetch(editingAgent ? `/api/agents/${editingAgent.id}` : '/api/agents', {
      method: editingAgent ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (payload.success) {
      if (editingAgent) {
        messageApi.success('代理账号已更新');
      } else {
        Modal.success({
          title: '代理账号已创建',
          content: (
            <div className="compact-list" style={{ marginTop: 8 }}>
              <Text>后续可在代理名单的密码列查看该登录密码。</Text>
              <Text>登录账号：<Text code>{values.username}</Text></Text>
              <Text>密码：<Text code>{payload.data?.initial_password || values.password}</Text></Text>
            </div>
          ),
        });
      }
      setAgentModalOpen(false);
      setEditingAgent(null);
      agentForm.resetFields();
      fetchData();
    } else {
      messageApi.error(payload.error || '保存失败');
    }
  };

  const saveChannel = async () => {
    const values = await channelForm.validateFields();
    const response = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('渠道已创建');
      setChannelModalOpen(false);
      channelForm.resetFields();
      fetchData();
    } else {
      messageApi.error(payload.error || '创建失败');
    }
  };

  const saveProduct = async () => {
    const values = await productForm.validateFields();
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('产品已创建');
      setProductModalOpen(false);
      productForm.resetFields();
      fetchData();
    } else {
      messageApi.error(payload.error || '创建失败');
    }
  };

  const updateAgentActive = async (agent: Agent) => {
    setUpdatingAgentIds((current) => [...current, agent.id]);
    const response = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !agent.is_active }),
    });
    const payload = await response.json();
    if (payload.success) {
      setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, ...payload.data } : item));
    } else {
      messageApi.error(payload.error || '更新失败');
    }
    setUpdatingAgentIds((current) => current.filter((id) => id !== agent.id));
  };

  const deleteAgent = async (agent: Agent) => {
    const response = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('代理账号已删除');
      setAgents((current) => current.filter((item) => item.id !== agent.id));
    } else {
      messageApi.error(payload.error || '删除失败');
    }
  };

  const updateChannelActive = async (channel: Channel) => {
    const response = await fetch(`/api/channels/${channel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !channel.is_active }),
    });
    const payload = await response.json();
    if (payload.success) {
      fetchData();
    } else {
      messageApi.error(payload.error || '更新失败');
    }
  };

  const importProps: UploadProps = {
    maxCount: 1,
    showUploadList: false,
    accept: '.csv,text/csv',
    beforeUpload: async (file) => {
      const csvText = await file.text();
      const response = await fetch('/api/management/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const payload = await response.json();
      const errors = payload.data?.errors || [];
      if (payload.data?.importedAgents > 0) {
        fetchData();
      }
      if (payload.success) {
        messageApi.success(payload.message || '批量导入成功');
      } else {
        Modal.warning({
          title: '批量导入存在错误',
          content: (
            <div className="compact-list" style={{ marginTop: 8 }}>
              {errors.length > 0 ? errors.slice(0, 12).map((error: string) => (
                <Text key={error} type="danger">{error}</Text>
              )) : <Text>{payload.error || '导入失败'}</Text>}
            </div>
          ),
        });
      }
      return false;
    },
  };

  const agentColumns = [
    {
      title: '产品',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 130,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '渠道',
      dataIndex: 'channel_name',
      key: 'channel_name',
      width: 130,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '代理商',
      dataIndex: 'name',
      key: 'name',
      width: 190,
      render: (value: string, record: Agent) => (
        <Space>
          <Text strong>{value}</Text>
          {isDemoAgent(record) && <Tag color="gold">demo</Tag>}
        </Space>
      ),
    },
    {
      title: '体裁',
      dataIndex: 'creative_types',
      key: 'creative_types',
      width: 190,
      render: (value: string[]) => {
        const creativeTypes = normalizeCreativeTypes(value);
        return creativeTypes.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {creativeTypes.map((item) => <Tag color="purple" key={item}>{item}</Tag>)}
          </Space>
        ) : <Text type="secondary">未配置</Text>;
      },
    },
    {
      title: '登录账号',
      dataIndex: 'username',
      key: 'username',
      width: 160,
    },
    {
      title: '密码',
      dataIndex: 'password_plaintext',
      key: 'password_plaintext',
      width: 160,
      render: (value: string | null) => value ? <Text code>{value}</Text> : <Text type="secondary">未记录</Text>,
    },
    {
      title: '飞书webhook',
      dataIndex: 'feishu_webhook',
      key: 'feishu_webhook',
      width: 260,
      ellipsis: true,
      render: (value: string | null) => value ? <Text code>{value}</Text> : <Text type="secondary">未配置</Text>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 120,
      render: (value: boolean, record: Agent) => (
        <Switch
          checked={value}
          loading={updatingAgentIds.includes(record.id)}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={() => updateAgentActive(record)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Agent) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => openAgentModal(record)}>编辑</Button>
          <Popconfirm
            title="物理删除该代理账号？"
            description="会同步删除该代理账号相关填报、告警和考核记录。"
            onConfirm={() => deleteAgent(record)}
          >
            <Button danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const productColumns = [
    {
      title: '产品',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 120,
      render: (value: boolean, record: Product) => (
        <Switch
          checked={value}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={async () => {
            const response = await fetch(`/api/products/${record.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_active: !record.is_active }),
            });
            const payload = await response.json();
            if (payload.success) {
              setProducts((current) => current.map((item) => item.id === record.id ? { ...item, ...payload.data } : item));
            } else {
              messageApi.error(payload.error || '更新失败');
            }
          }}
        />
      ),
    },
    {
      title: '说明',
      key: 'note',
      render: () => <Text type="secondary">产品停用后不会出现在新代理账号和筛选器里。</Text>,
    },
  ];

  const channelColumns = [
    {
      title: '渠道',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 120,
      render: (value: boolean, record: Channel) => (
        <Switch checked={value} checkedChildren="启用" unCheckedChildren="停用" onChange={() => updateChannelActive(record)} />
      ),
    },
    {
      title: '说明',
      key: 'note',
      render: () => <Text type="secondary">渠道停用后不会出现在新代理账号和填报筛选里。</Text>,
    },
  ];
  const resizableAgentColumns = useResizableColumns('admin-management-agents-columns', agentColumns);
  const resizableChannelColumns = useResizableColumns('admin-management-channels-columns', channelColumns);
  const resizableProductColumns = useResizableColumns('admin-management-products-columns', productColumns);

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <Tag color="cyan">账号与渠道</Tag>
          <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>公司级代理账号管理</Title>
          <Paragraph className="hero-text">
            每个外部代理公司一个账号，账号绑定唯一产品、渠道、代理商名称和可填报体裁。代理登录后无法切换归属。
          </Paragraph>
        </Card>

        <Card className="section-card">
          <div className="hero-row">
            <Tabs
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key as ActiveTab)}
              items={[
                { key: 'agents', label: '代理账号' },
                { key: 'channels', label: '渠道' },
                { key: 'products', label: '产品' },
              ]}
            />
            <Space>
              <Button href="/api/management/template" icon={<DownloadOutlined />}>下载模板 CSV</Button>
              <Upload {...importProps}>
                <Button icon={<UploadOutlined />}>上传 CSV 批量添加</Button>
              </Upload>
              <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
              {activeTab === 'agents' ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openAgentModal()}>新增代理账号</Button>
              ) : activeTab === 'products' ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setProductModalOpen(true)}>新增产品</Button>
              ) : (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setChannelModalOpen(true)}>新增渠道</Button>
              )}
            </Space>
          </div>
        </Card>

        <Card className="section-card">
          {activeTab === 'agents' ? (
            <Table<Agent>
              rowKey="id"
              loading={loading}
              dataSource={agents}
              columns={resizableAgentColumns}
              pagination={false}
              scroll={{ x: 1500 }}
              tableLayout="fixed"
            />
          ) : activeTab === 'products' ? (
            <Table<Product>
              rowKey="id"
              loading={loading}
              dataSource={products}
              columns={resizableProductColumns}
              pagination={false}
            />
          ) : (
            <Table<Channel>
              rowKey="id"
              loading={loading}
              dataSource={channels}
              columns={resizableChannelColumns}
              pagination={false}
            />
          )}
        </Card>
      </div>

      <Modal
        title={editingAgent ? '编辑代理账号' : '新增代理账号'}
        open={agentModalOpen}
        onOk={saveAgent}
        onCancel={() => setAgentModalOpen(false)}
        destroyOnHidden
      >
        <Form form={agentForm} layout="vertical">
          <Form.Item name="product_id" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
            <Select options={products.filter((product) => product.is_active).map((product) => ({ value: product.id, label: product.name }))} />
          </Form.Item>
          <Form.Item name="channel_id" label="渠道" rules={[{ required: true, message: '请选择渠道' }]}>
            <Select options={channels.filter((channel) => channel.is_active).map((channel) => ({ value: channel.id, label: channel.name }))} />
          </Form.Item>
          <Form.Item name="name" label="代理商名称" rules={[{ required: true, message: '请输入代理商名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="creative_types"
            label="体裁"
            rules={[{ required: true, message: '请至少填写一个体裁' }]}
          >
            <Select
              mode="tags"
              placeholder="选择或输入体裁"
              tokenSeparators={['、', ',', '，', '/', '|', ';', '；']}
              options={creativeTypeOptions}
              maxTagCount="responsive"
            />
          </Form.Item>
          <Form.Item name="username" label="登录账号" rules={[{ required: true, message: '请输入登录账号' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="feishu_webhook" label="飞书webhook">
            <Input placeholder="填写该代理账号对应的飞书 webhook / 标识" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingAgent ? '重置密码（可空）' : '密码'}
            rules={editingAgent ? [] : [{ required: true, message: '请输入密码' }]}
            extra={editingAgent ? '留空则不修改当前密码。' : '系统已随机生成 10 位密码，可手动修改。'}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="is_active" label="账号状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增渠道"
        open={channelModalOpen}
        onOk={saveChannel}
        onCancel={() => setChannelModalOpen(false)}
        destroyOnHidden
      >
        <Form form={channelForm} layout="vertical">
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: '请输入渠道名称' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增产品"
        open={productModalOpen}
        onOk={saveProduct}
        onCancel={() => setProductModalOpen(false)}
        destroyOnHidden
      >
        <Form form={productForm} layout="vertical" initialValues={{ is_active: true }}>
          <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label="产品状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
