'use client';

import React, { useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { AimOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMockApp } from '@/lib/mock/store';

const { Title, Paragraph, Text } = Typography;

export default function StrategyConsole() {
  const { state, latestPlan, latestStrategy, generatePlan } = useMockApp();
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const activeChannels = state.channels.filter((channel) => channel.is_active);
  const currentVersions = state.plans
    .filter((plan) => plan.strategyId === latestStrategy.id)
    .sort((left, right) => right.versionNumber - left.versionNumber);

  useEffect(() => {
    form.setFieldsValue({
      weekStart: dayjs(latestStrategy.weekStart),
      weekEnd: dayjs(latestStrategy.weekEnd),
      budgetUpperBound: latestStrategy.budgetUpperBound,
      minActivations: latestStrategy.minActivations,
      minRetentionDay1: latestStrategy.minRetentionDay1,
      minRetentionDay7: latestStrategy.minRetentionDay7,
      reason: latestPlan?.reason || '周中调优',
      constraints: activeChannels.map((channel) => {
        const existing = latestStrategy.channelShareConstraints.find((item) => item.channelId === channel.id);
        return {
          channelId: channel.id,
          channelName: channel.name,
          minShare: (existing?.minShare || 0) * 100,
          maxShare: (existing?.maxShare || 1) * 100,
        };
      }),
    });
  }, [activeChannels, form, latestPlan?.reason, latestStrategy]);

  const handleGenerate = async () => {
    const values = await form.validateFields();
    const result = generatePlan({
      weekStart: dayjs(values.weekStart).format('YYYY-MM-DD'),
      weekEnd: dayjs(values.weekEnd).format('YYYY-MM-DD'),
      budgetUpperBound: values.budgetUpperBound,
      minActivations: values.minActivations,
      minRetentionDay1: values.minRetentionDay1,
      minRetentionDay7: values.minRetentionDay7,
      reason: values.reason,
      channelShareConstraints: values.constraints.map((item: { channelId: string; minShare: number; maxShare: number }) => ({
        channelId: item.channelId,
        minShare: item.minShare / 100,
        maxShare: item.maxShare / 100,
      })),
    });

    if (result.success) {
      messageApi.success(result.message);
    } else {
      messageApi.error(result.message);
    }
  };

  const latestAndPrevious = currentVersions.slice(0, 2);
  const diffRows = latestAndPrevious.length === 2
    ? latestAndPrevious[0].channelAllocations.map((item) => {
      const previous = latestAndPrevious[1].channelAllocations.find((prev) => prev.channelId === item.channelId);
      return {
        key: item.channelId,
        channelName: item.channelName,
        currentBudget: item.budgetAmount,
        previousBudget: previous?.budgetAmount || 0,
        deltaBudget: item.budgetAmount - (previous?.budgetAmount || 0),
        currentShare: item.budgetShare,
        previousShare: previous?.budgetShare || 0,
      };
    })
    : [];

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <Tag color="purple">策略台</Tag>
          <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>
            <AimOutlined /> 周策略设定与一键分配
          </Title>
          <Paragraph className="hero-text">
            在这里录入本周总预算、四个核心约束和渠道预算占比区间。系统会基于近 2-4 周历史表现，自动给出渠道层与代理层的预算方案，并保留版本历史。
          </Paragraph>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="周预算上限" value={latestStrategy.budgetUpperBound} precision={0} prefix="¥" />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="激活量下限" value={latestStrategy.minActivations} />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="次留下限" value={latestStrategy.minRetentionDay1} suffix="%" />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="7留下限" value={latestStrategy.minRetentionDay7} suffix="%" />
            </Card>
          </Col>
        </Row>

        <Card className="section-card" title="录入本周约束">
          <Form form={form} layout="vertical">
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12} xl={6}>
                <Form.Item name="weekStart" label="周起始日" rules={[{ required: true, message: '请选择周起始日' }]}>
                  <DatePicker allowClear={false} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Form.Item name="weekEnd" label="周结束日" rules={[{ required: true, message: '请选择周结束日' }]}>
                  <DatePicker allowClear={false} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Form.Item name="budgetUpperBound" label="总预算上限" rules={[{ required: true, message: '请输入预算上限' }]}>
                  <InputNumber min={1} precision={0} style={{ width: '100%' }} prefix="¥" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Form.Item name="minActivations" label="激活量下限" rules={[{ required: true, message: '请输入激活量下限' }]}>
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="minRetentionDay1" label="次留率下限" rules={[{ required: true, message: '请输入次留率下限' }]}>
                  <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} suffix="%" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="minRetentionDay7" label="7留率下限" rules={[{ required: true, message: '请输入7留率下限' }]}>
                  <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} suffix="%" />
                </Form.Item>
              </Col>
            </Row>

            <Card type="inner" title="渠道预算占比约束" style={{ marginBottom: 16 }}>
              <Form.List name="constraints">
                {(fields) => (
                  <div className="constraint-grid">
                    {fields.map((field) => (
                      <div key={field.key} className="constraint-row">
                        <Form.Item name={[field.name, 'channelId']} hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'channelName']} label="渠道">
                          <Input disabled />
                        </Form.Item>
                        <Form.Item name={[field.name, 'minShare']} label="最小占比" rules={[{ required: true, message: '请输入最小占比' }]}>
                          <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} suffix="%" />
                        </Form.Item>
                        <Form.Item name={[field.name, 'maxShare']} label="最大占比" rules={[{ required: true, message: '请输入最大占比' }]}>
                          <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} suffix="%" />
                        </Form.Item>
                      </div>
                    ))}
                  </div>
                )}
              </Form.List>
            </Card>

            <Form.Item name="reason" label="本次生成说明" rules={[{ required: true, message: '请填写说明' }]}>
              <Input.TextArea rows={3} placeholder="例如：周三复盘发现百度持续超成本，适当将预算转向广点通和抖音。" />
            </Form.Item>

            <Space>
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerate}>
                一键生成本周分配方案
              </Button>
              <Text type="secondary">系统将自动生成新版本，并保留历史方案以便复盘。</Text>
            </Space>
          </Form>
        </Card>

        <Alert
          type={latestPlan?.forecastSummary.requiresReallocation ? 'warning' : 'success'}
          showIcon
          message={latestPlan?.forecastSummary.summary}
          description={latestPlan?.forecastSummary.warnings.join('；') || '当前方案满足主要约束。'}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <Card className="section-card" title="最新渠道分配方案">
              <Table
                rowKey="channelId"
                dataSource={latestPlan?.channelAllocations || []}
                pagination={false}
                columns={[
                  { title: '渠道', dataIndex: 'channelName', key: 'channelName', render: (value: string) => <Text strong>{value}</Text> },
                  { title: '预算金额', dataIndex: 'budgetAmount', key: 'budgetAmount', render: (value: number) => `¥${value.toLocaleString()}` },
                  { title: '预算占比', dataIndex: 'budgetShare', key: 'budgetShare', render: (value: number) => `${value.toFixed(1)}%` },
                  { title: '预测激活', dataIndex: 'predictedActivations', key: 'predictedActivations' },
                  { title: '预测CPA', dataIndex: 'predictedActivationCost', key: 'predictedActivationCost', render: (value: number) => `¥${value.toFixed(2)}` },
                  { title: '依据', dataIndex: 'rationale', key: 'rationale', width: 320 },
                ]}
                scroll={{ x: 1100 }}
              />
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card className="section-card" title="版本历史">
              <div className="insight-list">
                {currentVersions.map((version) => (
                  <div key={version.id} className="version-item">
                    <div>
                      <Text strong>V{version.versionNumber}</Text>
                      <Paragraph style={{ marginBottom: 0 }}>{version.reason}</Paragraph>
                      <Text type="secondary">{dayjs(version.createdAt).format('MM-DD HH:mm')}</Text>
                    </div>
                    <Tag color={version.forecastSummary.requiresReallocation ? 'red' : 'green'}>
                      {version.forecastSummary.requiresReallocation ? '需重算' : '可执行'}
                    </Tag>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>

        {diffRows.length > 0 && (
          <Card className="section-card" title="最近两版差异">
            <Table
              rowKey="key"
              dataSource={diffRows}
              pagination={false}
              columns={[
                { title: '渠道', dataIndex: 'channelName', key: 'channelName' },
                { title: '当前预算', dataIndex: 'currentBudget', key: 'currentBudget', render: (value: number) => `¥${value.toLocaleString()}` },
                { title: '上一版预算', dataIndex: 'previousBudget', key: 'previousBudget', render: (value: number) => `¥${value.toLocaleString()}` },
                {
                  title: '预算变化',
                  dataIndex: 'deltaBudget',
                  key: 'deltaBudget',
                  render: (value: number) => <Text type={value >= 0 ? 'success' : 'danger'}>{value >= 0 ? '+' : ''}¥{value.toLocaleString()}</Text>,
                },
                {
                  title: '占比变化',
                  key: 'shareChange',
                  render: (_: unknown, row: { currentShare: number; previousShare: number }) => (
                    <Text type={row.currentShare - row.previousShare >= 0 ? 'success' : 'danger'}>
                      {(row.currentShare - row.previousShare) >= 0 ? '+' : ''}
                      {(row.currentShare - row.previousShare).toFixed(1)}%
                    </Text>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
