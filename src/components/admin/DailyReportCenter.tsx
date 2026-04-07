'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  List,
  Row,
  Col,
  Statistic,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { useMockApp } from '@/lib/mock/store';
import { buildDailyReport } from '@/lib/mock/report';

const { Title, Paragraph, Text } = Typography;

export default function DailyReportCenter() {
  const { state, latestPlan, latestStrategy } = useMockApp();
  const [messageApi, contextHolder] = message.useMessage();
  const availableDates = useMemo(
    () => Array.from(new Set(state.records.map((record) => record.date))).sort((left, right) => right.localeCompare(left)),
    [state.records]
  );
  const [focusDate, setFocusDate] = useState(availableDates[0]);

  const report = useMemo(
    () => buildDailyReport(focusDate, state.records, latestStrategy, latestPlan),
    [focusDate, latestPlan, latestStrategy, state.records]
  );

  const copyReport = async () => {
    await navigator.clipboard.writeText(report.markdown);
    messageApi.success('日报 Markdown 已复制');
  };

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="hero-card">
          <div className="hero-row">
            <div>
              <TaglessTitle />
              <Title level={2} style={{ marginBottom: 8 }}>
                <FileTextOutlined /> 一键生成日报
              </Title>
              <Paragraph className="hero-text">
                按固定格式输出当日总览、渠道与代理进退步、关键预警和是否建议重分配，并提供一键复制 Markdown。
              </Paragraph>
            </div>
            <div className="hero-actions">
              <DatePicker
                value={focusDate ? dayjs(focusDate) : undefined}
                onChange={(value) => value && setFocusDate(value.format('YYYY-MM-DD'))}
                allowClear={false}
              />
              <Button type="primary" icon={<CopyOutlined />} onClick={copyReport}>
                复制 Markdown
              </Button>
            </div>
          </div>
        </Card>

        <Alert
          type={report.shouldReallocate ? 'warning' : 'success'}
          showIcon
          message={report.headline}
          description={report.evidence.join(' ')}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}><Card className="metric-card"><Statistic title="总消耗" value={report.totals.cost} precision={2} prefix="¥" /></Card></Col>
          <Col xs={24} md={12} xl={6}><Card className="metric-card"><Statistic title="总激活" value={report.totals.activations} /></Card></Col>
          <Col xs={24} md={12} xl={6}><Card className="metric-card"><Statistic title="激活成本" value={report.totals.activationCost} precision={2} prefix="¥" /></Card></Col>
          <Col xs={24} md={12} xl={6}><Card className="metric-card"><Statistic title="是否建议重分配" value={report.shouldReallocate ? '建议' : '暂不'} /></Card></Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card className="section-card" title="渠道进步 / 退步">
              <List
                header={<Text strong>渠道进步 TOP</Text>}
                dataSource={report.channelHighlights}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
              <List
                header={<Text strong>渠道退步 TOP</Text>}
                dataSource={report.channelRisks}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card className="section-card" title="代理进步 / 退步">
              <List
                header={<Text strong>代理进步 TOP</Text>}
                dataSource={report.agentHighlights}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
              <List
                header={<Text strong>代理退步 TOP</Text>}
                dataSource={report.agentRisks}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
          </Col>
        </Row>

        <Card className="section-card" title="关键预警与数据依据">
          <List
            header={<Text strong>关键预警</Text>}
            dataSource={report.warnings.length > 0 ? report.warnings : ['暂无严重预警']}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
          <List
            header={<Text strong>数据依据摘要</Text>}
            dataSource={report.evidence}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
        </Card>

        <Card className="section-card" title="Markdown 预览">
          <pre className="markdown-preview">{report.markdown}</pre>
        </Card>
      </div>
    </>
  );
}

function TaglessTitle() {
  return <Text type="secondary">日报中心</Text>;
}
