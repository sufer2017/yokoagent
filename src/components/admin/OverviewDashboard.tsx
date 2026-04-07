'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { DashboardOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { UploadProps } from 'antd';
import { useMockApp } from '@/lib/mock/store';
import { buildOverviewInsights } from '@/lib/mock/insights';

const { Title, Text, Paragraph } = Typography;

export default function OverviewDashboard() {
  const { state, latestPlan, latestStrategy, importCsvText, resetDemo } = useMockApp();
  const [messageApi, contextHolder] = message.useMessage();
  const availableDates = useMemo(
    () => Array.from(new Set(state.records.map((record) => record.date))).sort((left, right) => right.localeCompare(left)),
    [state.records]
  );
  const [focusDate, setFocusDate] = useState(availableDates[0]);

  const scopedHistory = useMemo(
    () => state.records.filter((record) => record.date <= focusDate),
    [focusDate, state.records]
  );
  const currentDayRecords = useMemo(
    () => state.records.filter((record) => record.date === focusDate),
    [focusDate, state.records]
  );
  const channelInsights = useMemo(
    () => buildOverviewInsights('channel', scopedHistory, latestStrategy, latestPlan),
    [latestPlan, latestStrategy, scopedHistory]
  );
  const agentInsights = useMemo(
    () => buildOverviewInsights('agent', scopedHistory, latestStrategy, latestPlan),
    [latestPlan, latestStrategy, scopedHistory]
  );

  const summary = useMemo(() => {
    const cost = currentDayRecords.reduce((sum, record) => sum + record.cost, 0);
    const activations = currentDayRecords.reduce((sum, record) => sum + record.activations, 0);
    const retentionDay1 = currentDayRecords.length > 0
      ? currentDayRecords.reduce((sum, record) => sum + record.retentionDay1, 0) / currentDayRecords.length
      : 0;
    const retentionDay7 = currentDayRecords.length > 0
      ? currentDayRecords.reduce((sum, record) => sum + record.retentionDay7, 0) / currentDayRecords.length
      : 0;

    return {
      cost,
      activations,
      activationCost: activations > 0 ? cost / activations : 0,
      retentionDay1,
      retentionDay7,
      warningCount: [...channelInsights, ...agentInsights].filter((item) => item.warningCount > 0).length,
    };
  }, [agentInsights, channelInsights, currentDayRecords]);

  const uploaderProps: UploadProps = {
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      const text = await file.text();
      const result = importCsvText(text);
      if (result.success) {
        messageApi.success(result.message);
      } else {
        messageApi.error(result.message);
        result.errors?.forEach((error) => messageApi.warning(error));
      }
      return false;
    },
  };

  const channelColumns = [
    {
      title: '排名',
      dataIndex: 'rank',
      key: 'rank',
      width: 72,
      render: (value: number) => <Tag color={value <= 2 ? 'gold' : 'default'}>#{value}</Tag>,
    },
    {
      title: '渠道',
      dataIndex: 'scopeLabel',
      key: 'scopeLabel',
      width: 120,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '总结',
      dataIndex: 'summary',
      key: 'summary',
      width: 420,
      render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
    },
    {
      title: '成本',
      dataIndex: ['metrics', 'activationCost'],
      key: 'activationCost',
      width: 110,
      render: (value: number) => `¥${value.toFixed(2)}`,
    },
    {
      title: '激活量',
      dataIndex: ['metrics', 'activations'],
      key: 'activations',
      width: 90,
    },
    {
      title: '较近7日',
      dataIndex: 'vsTrailing7dActivationCost',
      key: 'vsTrailing7dActivationCost',
      width: 110,
      render: (value: number) => (
        <Text type={value > 0 ? 'danger' : 'success'}>
          {value > 0 ? '+' : ''}
          {value.toFixed(0)}%
        </Text>
      ),
    },
    {
      title: '较上周',
      dataIndex: 'vsPreviousWeekActivationCost',
      key: 'vsPreviousWeekActivationCost',
      width: 110,
      render: (value: number) => (
        <Text type={value > 0 ? 'danger' : 'success'}>
          {value > 0 ? '+' : ''}
          {value.toFixed(0)}%
        </Text>
      ),
    },
    {
      title: '预警',
      dataIndex: 'warningCount',
      key: 'warningCount',
      width: 90,
      render: (value: number) => <Tag color={value > 0 ? 'red' : 'green'}>{value}</Tag>,
    },
  ];

  const agentColumns = [
    {
      title: '排名',
      dataIndex: 'rank',
      key: 'rank',
      width: 72,
      render: (value: number) => <Tag color={value <= 3 ? 'cyan' : 'default'}>#{value}</Tag>,
    },
    {
      title: '代理',
      dataIndex: 'scopeLabel',
      key: 'scopeLabel',
      width: 120,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '渠道',
      dataIndex: 'parentLabel',
      key: 'parentLabel',
      width: 110,
    },
    {
      title: '总结',
      dataIndex: 'summary',
      key: 'summary',
      width: 420,
      render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
    },
    {
      title: '次留率',
      dataIndex: ['metrics', 'retentionDay1'],
      key: 'retentionDay1',
      width: 100,
      render: (value: number) => `${value.toFixed(1)}%`,
    },
    {
      title: '较同渠道',
      dataIndex: 'vsPeersRetentionDay1',
      key: 'vsPeersRetentionDay1',
      width: 110,
      render: (value: number) => (
        <Text type={value >= 0 ? 'success' : 'danger'}>
          {value > 0 ? '+' : ''}
          {value.toFixed(1)}pt
        </Text>
      ),
    },
    {
      title: '预警',
      dataIndex: 'warningCount',
      key: 'warningCount',
      width: 90,
      render: (value: number) => <Tag color={value > 0 ? 'red' : 'green'}>{value}</Tag>,
    },
  ];

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <div className="hero-row">
            <div>
              <Tag color="blue">数据总览</Tag>
              <Title level={2} style={{ marginTop: 12, marginBottom: 8 }}>
                <DashboardOutlined /> 全局赛马与预警视图
              </Title>
              <Paragraph className="hero-text">
                围绕当前周策略，把渠道层与代理层的横向赛马、纵向趋势、预警密度和总结文案放在同一块屏幕里。
              </Paragraph>
            </div>
            <div className="hero-actions">
              <DatePicker
                value={focusDate ? dayjs(focusDate) : undefined}
                onChange={(value) => {
                  if (value) setFocusDate(value.format('YYYY-MM-DD'));
                }}
                allowClear={false}
              />
              <Upload {...uploaderProps}>
                <Button icon={<InboxOutlined />}>导入历史 CSV</Button>
              </Upload>
              <Button icon={<ReloadOutlined />} onClick={resetDemo}>
                重置 Demo
              </Button>
            </div>
          </div>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="当日总消耗" value={summary.cost} precision={2} prefix="¥" />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="当日总激活" value={summary.activations} />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="激活成本" value={summary.activationCost} precision={2} prefix="¥" />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="metric-card">
              <Statistic title="预警对象数" value={summary.warningCount} valueStyle={summary.warningCount > 0 ? { color: '#d4380d' } : undefined} />
            </Card>
          </Col>
        </Row>

        <Alert
          type={latestPlan?.forecastSummary.requiresReallocation ? 'warning' : 'success'}
          showIcon
          message={latestPlan?.forecastSummary.summary || '当前暂无预算分配方案'}
          description={`本周预算上限 ¥${latestStrategy.budgetUpperBound.toLocaleString()}，次留下限 ${latestStrategy.minRetentionDay1}% ，7留下限 ${latestStrategy.minRetentionDay7}% 。`}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card className="section-card" title="渠道层赛马">
              <Table
                rowKey="id"
                dataSource={channelInsights}
                columns={channelColumns}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card className="section-card" title="代理层赛马">
              <Table
                rowKey="id"
                dataSource={agentInsights}
                columns={agentColumns}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card className="section-card" title="今日最佳渠道与代理">
              <div className="insight-grid">
                <div className="insight-tile">
                  <Text type="secondary">最佳渠道</Text>
                  <Title level={4}>{channelInsights[0]?.scopeLabel || '-'}</Title>
                  <Paragraph>{channelInsights[0]?.summary}</Paragraph>
                </div>
                <div className="insight-tile">
                  <Text type="secondary">最佳代理</Text>
                  <Title level={4}>{agentInsights[0]?.scopeLabel || '-'}</Title>
                  <Paragraph>{agentInsights[0]?.summary}</Paragraph>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card className="section-card" title="重点预警">
              <div className="insight-list">
                {[...channelInsights, ...agentInsights]
                  .filter((item) => item.warningCount > 0)
                  .slice(0, 5)
                  .map((item) => (
                    <div key={item.id} className="warning-item">
                      <div>
                        <Text strong>{item.scopeLabel}</Text>
                        <Paragraph style={{ marginBottom: 0 }}>{item.summary}</Paragraph>
                      </div>
                      <Tag color="red">{item.warningCount} 项</Tag>
                    </div>
                  ))}
                {[...channelInsights, ...agentInsights].filter((item) => item.warningCount > 0).length === 0 && (
                  <Text type="secondary">当前所选日期之前暂无高风险对象，建议继续保持当前策略执行。</Text>
                )}
              </div>
            </Card>
          </Col>
        </Row>
      </div>
    </>
  );
}
