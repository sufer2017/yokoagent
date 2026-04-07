'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { DashboardOutlined } from '@ant-design/icons';
import { checkRecordViolations } from '@/lib/helpers/constraintChecker';
import {
  computeActivationCost,
  formatCurrency,
  formatPercent,
} from '@/lib/helpers/formatters';
import type {
  Agent,
  Channel,
  Constraint,
  DailyRecordView,
  Project,
} from '@/types/database';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface ComparisonRow {
  key: string;
  label: string;
  cost: number;
  activations: number;
  activation_cost: number | null;
  retention_day1: number | null;
  retention_day7: number | null;
  record_count: number;
  violation_count: number;
}

function average(values: Array<number | null | undefined>) {
  const validValues = values.filter((value): value is number => value != null);
  if (validValues.length === 0) {
    return null;
  }

  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function buildComparisonRows(
  records: DailyRecordView[],
  violationMap: Map<string, Set<string>>,
  groupBy: 'agent_name' | 'record_date'
): ComparisonRow[] {
  const groups = new Map<string, DailyRecordView[]>();

  for (const record of records) {
    const key = String(record[groupBy] || '未命名');
    const existing = groups.get(key) || [];
    existing.push(record);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, groupRecords]) => {
      const cost = groupRecords.reduce((sum, record) => sum + Number(record.cost || 0), 0);
      const activations = groupRecords.reduce((sum, record) => sum + Number(record.activations || 0), 0);
      const violationCount = groupRecords.reduce(
        (sum, record) => sum + (violationMap.get(record.id)?.size || 0),
        0
      );

      return {
        key,
        label: key,
        cost,
        activations,
        activation_cost: computeActivationCost(cost, activations),
        retention_day1: average(groupRecords.map((record) => record.retention_day1)),
        retention_day7: average(groupRecords.map((record) => record.retention_day7)),
        record_count: groupRecords.length,
        violation_count: violationCount,
      };
    })
    .sort((left, right) => {
      if (groupBy === 'record_date') {
        return right.label.localeCompare(left.label);
      }

      return right.activations - left.activations;
    });
}

function getConstraintNames(
  metric: string,
  recordId: string,
  violationMap: Map<string, Set<string>>,
  violationDetailMap: Map<string, string[]>
) {
  const keys = violationMap.get(recordId);
  if (!keys?.has(metric)) {
    return [];
  }

  return violationDetailMap.get(`${recordId}:${metric}`) || [];
}

export default function OverviewDashboard() {
  const [records, setRecords] = useState<DailyRecordView[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, 'day'),
    dayjs(),
  ]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selectedChannelId, setSelectedChannelId] = useState<string>();
  const [selectedProjectId, setSelectedProjectId] = useState<string>();

  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const [agentRes, channelRes, projectRes, constraintRes] = await Promise.all([
          fetch('/api/agents?active=false').then((response) => response.json()),
          fetch('/api/channels').then((response) => response.json()),
          fetch('/api/projects').then((response) => response.json()),
          fetch('/api/constraints').then((response) => response.json()),
        ]);

        if (agentRes.success) {
          setAgents(agentRes.data);
        }
        if (channelRes.success) {
          setChannels(channelRes.data);
        }
        if (projectRes.success) {
          setProjects(projectRes.data);
        }
        if (constraintRes.success) {
          setConstraints(constraintRes.data);
        }
      } catch {
        messageApi.error('加载筛选条件失败');
      }
    };

    void fetchMeta();
  }, [messageApi]);

  useEffect(() => {
    const fetchRecords = async () => {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          dateFrom: dateRange[0].format('YYYY-MM-DD'),
          dateTo: dateRange[1].format('YYYY-MM-DD'),
        });

        if (selectedAgentId) {
          params.set('agentId', selectedAgentId);
        }
        if (selectedChannelId) {
          params.set('channelId', selectedChannelId);
        }
        if (selectedProjectId) {
          params.set('projectId', selectedProjectId);
        }

        const response = await fetch(`/api/records?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setRecords(data.data);
          return;
        }

        messageApi.error(data.error || '加载数据失败');
      } catch {
        messageApi.error('加载数据失败');
      } finally {
        setLoading(false);
      }
    };

    void fetchRecords();
  }, [dateRange, selectedAgentId, selectedChannelId, selectedProjectId, messageApi]);

  const { violationMap, violationDetailMap, violationCount } = useMemo(() => {
    const nextViolationMap = new Map<string, Set<string>>();
    const nextViolationDetailMap = new Map<string, string[]>();
    let nextViolationCount = 0;

    for (const record of records) {
      const violations = checkRecordViolations(record, constraints);

      for (const violation of violations) {
        nextViolationCount += 1;

        const recordMetrics = nextViolationMap.get(record.id) || new Set<string>();
        recordMetrics.add(violation.constraint_metric);
        nextViolationMap.set(record.id, recordMetrics);

        const detailKey = `${record.id}:${violation.constraint_metric}`;
        const existingDetails = nextViolationDetailMap.get(detailKey) || [];
        existingDetails.push(
          `${violation.constraint_name} ${violation.constraint_operator} ${violation.constraint_value}`
        );
        nextViolationDetailMap.set(detailKey, existingDetails);
      }
    }

    return {
      violationMap: nextViolationMap,
      violationDetailMap: nextViolationDetailMap,
      violationCount: nextViolationCount,
    };
  }, [constraints, records]);

  const summary = useMemo(() => {
    const totalCost = records.reduce((sum, record) => sum + Number(record.cost || 0), 0);
    const totalActivations = records.reduce((sum, record) => sum + Number(record.activations || 0), 0);

    return {
      totalCost,
      totalActivations,
      activationCost: computeActivationCost(totalCost, totalActivations),
      retentionDay1: average(records.map((record) => record.retention_day1)),
      retentionDay7: average(records.map((record) => record.retention_day7)),
    };
  }, [records]);

  const agentComparisonRows = useMemo(
    () => buildComparisonRows(records, violationMap, 'agent_name'),
    [records, violationMap]
  );
  const trendRows = useMemo(
    () => buildComparisonRows(records, violationMap, 'record_date'),
    [records, violationMap]
  );

  const comparisonColumns = [
    {
      title: '维度',
      dataIndex: 'label',
      key: 'label',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '消耗',
      dataIndex: 'cost',
      key: 'cost',
      render: (value: number) => formatCurrency(value),
    },
    {
      title: '激活数',
      dataIndex: 'activations',
      key: 'activations',
    },
    {
      title: '激活成本',
      dataIndex: 'activation_cost',
      key: 'activation_cost',
      render: (value: number | null) => formatCurrency(value),
    },
    {
      title: '次留率',
      dataIndex: 'retention_day1',
      key: 'retention_day1',
      render: (value: number | null) => formatPercent(value),
    },
    {
      title: '7留率',
      dataIndex: 'retention_day7',
      key: 'retention_day7',
      render: (value: number | null) => formatPercent(value),
    },
    {
      title: '预警',
      dataIndex: 'violation_count',
      key: 'violation_count',
      width: 100,
      render: (value: number) =>
        value > 0 ? <Tag color="red">{value}</Tag> : <Tag color="green">0</Tag>,
    },
  ];

  const detailColumns = [
    {
      title: '日期',
      dataIndex: 'record_date',
      key: 'record_date',
      width: 120,
    },
    {
      title: '代理',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 120,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '渠道',
      dataIndex: 'channel_name',
      key: 'channel_name',
      width: 120,
    },
    {
      title: '项目',
      dataIndex: 'project_name',
      key: 'project_name',
      width: 120,
    },
    {
      title: '消耗',
      dataIndex: 'cost',
      key: 'cost',
      width: 130,
      render: (value: number, record: DailyRecordView) => {
        const warnings = getConstraintNames('cost', record.id, violationMap, violationDetailMap);
        const style = warnings.length > 0 ? { color: '#cf1322', fontWeight: 600 } : undefined;

        return (
          <span style={style} title={warnings.join('；')}>
            {formatCurrency(Number(value))}
          </span>
        );
      },
    },
    {
      title: '激活数',
      dataIndex: 'activations',
      key: 'activations',
      width: 100,
      render: (value: number, record: DailyRecordView) => {
        const warnings = getConstraintNames('activations', record.id, violationMap, violationDetailMap);
        const style = warnings.length > 0 ? { color: '#cf1322', fontWeight: 600 } : undefined;

        return (
          <span style={style} title={warnings.join('；')}>
            {value}
          </span>
        );
      },
    },
    {
      title: '激活成本',
      key: 'activation_cost',
      width: 130,
      render: (_: unknown, record: DailyRecordView) => {
        const activationCost = computeActivationCost(Number(record.cost || 0), Number(record.activations || 0));
        const warnings = getConstraintNames('activation_cost', record.id, violationMap, violationDetailMap);
        const style = warnings.length > 0 ? { color: '#cf1322', fontWeight: 600 } : undefined;

        return (
          <span style={style} title={warnings.join('；')}>
            {formatCurrency(activationCost)}
          </span>
        );
      },
    },
    {
      title: '次留率',
      dataIndex: 'retention_day1',
      key: 'retention_day1',
      width: 110,
      render: (value: number | null, record: DailyRecordView) => {
        const warnings = getConstraintNames('retention_day1', record.id, violationMap, violationDetailMap);
        const style = warnings.length > 0 ? { color: '#cf1322', fontWeight: 600 } : undefined;

        return (
          <span style={style} title={warnings.join('；')}>
            {formatPercent(value)}
          </span>
        );
      },
    },
    {
      title: '7留率',
      dataIndex: 'retention_day7',
      key: 'retention_day7',
      width: 110,
      render: (value: number | null, record: DailyRecordView) => {
        const warnings = getConstraintNames('retention_day7', record.id, violationMap, violationDetailMap);
        const style = warnings.length > 0 ? { color: '#cf1322', fontWeight: 600 } : undefined;

        return (
          <span style={style} title={warnings.join('；')}>
            {formatPercent(value)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Title level={4} style={{ margin: 0 }}>
              <DashboardOutlined /> 数据总览
            </Title>
            <Space wrap>
              <RangePicker
                value={dateRange}
                onChange={(value) => {
                  if (value?.[0] && value?.[1]) {
                    setDateRange([value[0], value[1]]);
                  }
                }}
              />
              <Select
                allowClear
                placeholder="筛选代理"
                style={{ width: 180 }}
                value={selectedAgentId}
                onChange={setSelectedAgentId}
                options={agents.map((agent) => ({
                  label: `${agent.name}${agent.is_active ? '' : '（停用）'}`,
                  value: agent.id,
                }))}
              />
              <Select
                allowClear
                placeholder="筛选渠道"
                style={{ width: 180 }}
                value={selectedChannelId}
                onChange={setSelectedChannelId}
                options={channels.map((channel) => ({
                  label: channel.name,
                  value: channel.id,
                }))}
              />
              <Select
                allowClear
                placeholder="筛选项目"
                style={{ width: 180 }}
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                options={projects.map((project) => ({
                  label: project.name,
                  value: project.id,
                }))}
              />
            </Space>
          </Space>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={loading}>
              <Statistic title="总消耗" value={summary.totalCost} precision={2} prefix="¥" />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={loading}>
              <Statistic title="总激活数" value={summary.totalActivations} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={loading}>
              <Statistic
                title="平均激活成本"
                value={summary.activationCost ?? 0}
                precision={2}
                prefix="¥"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={loading}>
              <Statistic title="预警条数" value={violationCount} valueStyle={violationCount > 0 ? { color: '#cf1322' } : undefined} />
            </Card>
          </Col>
        </Row>

        {violationCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            message={`当前筛选范围内共有 ${violationCount} 条约束预警，明细表中的超限单元格已标红。`}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            message="当前筛选范围内暂无约束预警。"
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="横向对比：代理表现" loading={loading}>
              <Table
                dataSource={agentComparisonRows}
                columns={comparisonColumns}
                rowKey="key"
                pagination={false}
                locale={{ emptyText: <Empty description="当前筛选下暂无代理数据" /> }}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title="纵向对比：历史趋势" loading={loading}>
              <Table
                dataSource={trendRows}
                columns={comparisonColumns}
                rowKey="key"
                pagination={false}
                locale={{ emptyText: <Empty description="当前筛选下暂无趋势数据" /> }}
              />
            </Card>
          </Col>
        </Row>

        <Card
          title="明细数据与约束预警"
          extra={
            <Space split={<Text type="secondary">/</Text>}>
              <Text>次留率 {formatPercent(summary.retentionDay1)}</Text>
              <Text>7留率 {formatPercent(summary.retentionDay7)}</Text>
            </Space>
          }
          loading={loading}
        >
          <Table
            dataSource={records}
            columns={detailColumns}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1100 }}
            locale={{ emptyText: <Empty description="当前筛选下暂无明细数据" /> }}
          />
        </Card>
      </Space>
    </>
  );
}
