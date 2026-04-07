'use client';

import React, { useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Segmented,
  Switch,
  Table,
  Typography,
} from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { Agent, Channel, Project } from '@/types/database';
import { useMockApp } from '@/lib/mock/store';

const { Title, Paragraph, Text } = Typography;

type EntityTab = 'agents' | 'channels' | 'projects';

export default function ManagementConsole() {
  const { state, upsertEntity, toggleEntityActive } = useMockApp();
  const [activeTab, setActiveTab] = useState<EntityTab>('agents');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Agent | Channel | Project | null>(null);
  const [form] = Form.useForm();

  const collections = {
    agents: state.agents,
    channels: state.channels,
    projects: state.projects,
  };

  const openModal = (entity?: Agent | Channel | Project) => {
    setEditingEntity(entity || null);
    form.setFieldsValue({ name: entity?.name || '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    upsertEntity(activeTab, { id: editingEntity?.id, name: values.name });
    setModalOpen(false);
    setEditingEntity(null);
    form.resetFields();
  };

  return (
    <div className="console-stack">
      <Card className="hero-card">
        <Title level={2} style={{ marginBottom: 8 }}>渠道与代理管理</Title>
        <Paragraph className="hero-text">
          统一维护代理池、渠道与项目。第一版以 mock 数据演示完整增删改启停能力，变更会立即反映到策略台、总览和日报中心。
        </Paragraph>
      </Card>

      <Card className="section-card">
        <div className="hero-row">
          <Segmented
            value={activeTab}
            onChange={(value) => setActiveTab(value as EntityTab)}
            options={[
              { label: '代理管理', value: 'agents' },
              { label: '渠道管理', value: 'channels' },
              { label: '项目管理', value: 'projects' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            新增{activeTab === 'agents' ? '代理' : activeTab === 'channels' ? '渠道' : '项目'}
          </Button>
        </div>
      </Card>

      <Card className="section-card">
        <Table
          rowKey="id"
          dataSource={collections[activeTab]}
          columns={[
            {
              title: activeTab === 'agents' ? '代理名称' : activeTab === 'channels' ? '渠道名称' : '项目名称',
              dataIndex: 'name',
              key: 'name',
              render: (value: string) => <Text strong>{value}</Text>,
            },
            {
              title: '状态',
              dataIndex: 'is_active',
              key: 'is_active',
              width: 120,
              render: (value: boolean, record: Agent | Channel | Project) => (
                <Switch checked={value} onChange={() => toggleEntityActive(activeTab, record.id)} />
              ),
            },
            {
              title: '操作',
              key: 'action',
              width: 120,
              render: (_: unknown, record: Agent | Channel | Project) => (
                <Button icon={<EditOutlined />} onClick={() => openModal(record)}>
                  编辑
                </Button>
              ),
            },
          ]}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingEntity ? '编辑实体' : '新增实体'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
