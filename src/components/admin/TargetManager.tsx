'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { Agent, Channel, Product, TargetChange } from '@/types/database';
import { useResizableColumns } from '@/components/common/useResizableColumns';

const { Title, Paragraph, Text } = Typography;

export default function TargetManager() {
  const [targets, setTargets] = useState<TargetChange[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [targetRes, agentRes, channelRes, productRes] = await Promise.all([
        fetch('/api/targets').then((res) => res.json()),
        fetch('/api/agents?active=false').then((res) => res.json()),
        fetch('/api/channels?active=false').then((res) => res.json()),
        fetch('/api/products?active=false').then((res) => res.json()),
      ]);

      if (!targetRes.success) throw new Error(targetRes.error || '指标加载失败');
      if (!agentRes.success) throw new Error(agentRes.error || '代理加载失败');
      if (!channelRes.success) throw new Error(channelRes.error || '渠道加载失败');
      if (!productRes.success) throw new Error(productRes.error || '产品加载失败');
      setTargets(targetRes.data || []);
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

  const selectedProductId = Form.useWatch('product_id', form) as string | undefined;
  const selectedChannelId = Form.useWatch('channel_id', form) as string | undefined;
  const selectedAgentId = Form.useWatch('agent_id', form) as string | undefined;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (selectedAgent) {
      form.setFieldValue('product_id', selectedAgent.product_id);
      form.setFieldValue('channel_id', selectedAgent.channel_id);
    }
  }, [form, selectedAgent]);

  const clearAgentIfOutOfScope = (productId?: string, channelId?: string) => {
    const currentAgentId = form.getFieldValue('agent_id');
    const currentAgent = agents.find((agent) => agent.id === currentAgentId);
    if (!currentAgent) return;
    if ((productId && currentAgent.product_id !== productId) || (channelId && currentAgent.channel_id !== channelId)) {
      form.setFieldValue('agent_id', undefined);
    }
  };

  const syncAgentScope = (agentId?: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    form.setFieldsValue({
      product_id: agent.product_id,
      channel_id: agent.channel_id,
    });
  };

  const createTarget = async () => {
    const values = await form.validateFields();
    const response = await fetch('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        effective_date: values.effective_date.format('YYYY-MM-DD'),
      }),
    });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('考核指标已新增');
      setModalOpen(false);
      form.resetFields();
      fetchData();
    } else {
      messageApi.error(payload.error || '新增失败');
    }
  };

  const deleteTarget = async (id: string) => {
    const response = await fetch(`/api/targets/${id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (payload.success) {
      messageApi.success('已删除');
      fetchData();
    } else {
      messageApi.error(payload.error || '删除失败');
    }
  };

  const importProps: UploadProps = {
    maxCount: 1,
    showUploadList: false,
    accept: '.csv,text/csv',
    beforeUpload: async (file) => {
      const csvText = await file.text();
      const response = await fetch('/api/targets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const payload = await response.json();
      const errors = payload.data?.errors || [];
      if (payload.data?.imported > 0) {
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

  const filteredAgents = agents.filter((agent) => (
    (!selectedProductId || agent.product_id === selectedProductId) &&
    (!selectedChannelId || agent.channel_id === selectedChannelId)
  ));

  const agentOptions = filteredAgents.map((agent) => ({
    value: agent.id,
    label: `${agent.product_name || ''} / ${agent.channel_name || ''} / ${agent.name}`,
  }));

  const productOptions = products.map((product) => ({
    value: product.id,
    label: product.name,
  }));

  const channelOptions = channels.map((channel) => ({
    value: channel.id,
    label: channel.name,
  }));

  const columns = [
    {
      title: '生效日期',
      dataIndex: 'effective_date',
      key: 'effective_date',
      width: 120,
    },
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
      width: 120,
    },
    {
      title: '代理商',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 140,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '体裁',
      dataIndex: 'creative_type',
      key: 'creative_type',
      width: 110,
    },
    {
      title: '是否在投',
      dataIndex: 'is_running',
      key: 'is_running',
      width: 110,
      render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>,
    },
    {
      title: '考核CPA',
      dataIndex: 'target_cpa',
      key: 'target_cpa',
      width: 110,
      render: (value: number | null) => value ?? '-',
    },
    {
      title: '考核次留',
      dataIndex: 'target_retention_day1',
      key: 'target_retention_day1',
      width: 110,
      render: (value: number | null) => value == null ? '-' : `${value}%`,
    },
    {
      title: '考核7留',
      dataIndex: 'target_retention_day7',
      key: 'target_retention_day7',
      width: 110,
      render: (value: number | null) => value == null ? '-' : `${value}%`,
    },
    {
      title: '激活量级上限',
      dataIndex: 'activation_cap',
      key: 'activation_cap',
      width: 130,
      render: (value: number | null) => value ?? '-',
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      render: (_: unknown, record: TargetChange) => (
        <Popconfirm title="删除该考核记录？" onConfirm={() => deleteTarget(record.id)}>
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];
  const resizableColumns = useResizableColumns('admin-target-columns', columns);

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <Tag color="purple">Sheet4</Tag>
          <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>考核指标变更记录</Title>
          <Paragraph className="hero-text">
            这里是“是否在投”和考核指标的唯一权威来源。填报明细会按生效日期自动匹配最新记录。
          </Paragraph>
        </Card>

        <Card className="section-card">
          <div className="hero-row">
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                form.resetFields();
                form.setFieldsValue({ is_running: true, effective_date: dayjs().subtract(30, 'day') });
                setModalOpen(true);
              }}>
                新增考核记录
              </Button>
              <Button href="/api/targets/template" icon={<DownloadOutlined />}>下载模板 CSV</Button>
              <Upload {...importProps}>
                <Button icon={<UploadOutlined />}>上传 CSV 批量添加</Button>
              </Upload>
              <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            </Space>
          </div>
        </Card>

        <Card className="section-card" title="指标历史">
          <Table
            rowKey="id"
            loading={loading}
            dataSource={targets}
            columns={resizableColumns}
            locale={{ emptyText: '暂无考核指标。请先新增代理账号，再录入是否在投和考核 CPA/次留/7留。' }}
            scroll={{ x: 1280 }}
          />
        </Card>
      </div>

      <Modal
        title="新增考核指标"
        open={modalOpen}
        onOk={createTarget}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="product_id" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={productOptions}
              onChange={(value) => clearAgentIfOutOfScope(value, form.getFieldValue('channel_id'))}
            />
          </Form.Item>
          <Form.Item name="channel_id" label="渠道" rules={[{ required: true, message: '请选择渠道' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={channelOptions}
              onChange={(value) => clearAgentIfOutOfScope(form.getFieldValue('product_id'), value)}
            />
          </Form.Item>
          <Form.Item name="agent_id" label="代理商" rules={[{ required: true, message: '请选择代理商' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={agentOptions}
              placeholder="可先选择产品和渠道缩小范围"
              onChange={syncAgentScope}
            />
          </Form.Item>
          <Form.Item name="creative_type" label="体裁" rules={[{ required: true, message: '请输入体裁' }]}>
            <Input placeholder="短剧/小说/工具/小游戏" />
          </Form.Item>
          <Form.Item name="is_running" label="是否在投" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
          <Form.Item name="effective_date" label="考核生效日期" rules={[{ required: true, message: '请选择生效日期' }]}>
            <DatePicker allowClear={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="target_cpa" label="考核CPA">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="target_retention_day1" label="考核次留">
            <InputNumber min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="target_retention_day7" label="考核7留">
            <InputNumber min={0} max={100} precision={2} suffix="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="activation_cap" label="激活量级上限">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
