'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import MbiMultiSelect from '@/components/admin/MbiMultiSelect';
import { useResizableColumns } from '@/components/common/useResizableColumns';

const Bar = dynamic(async () => (await import('@ant-design/charts')).Bar as React.ComponentType<Record<string, unknown>>, { ssr: false });

const { RangePicker } = DatePicker;
const { Title, Paragraph, Text } = Typography;

type FillStatus = 'missing' | 'pending' | 'late' | 'on_time' | 'not_required';

interface FillDetailRow {
  id: string;
  date: string;
  agent_id: string;
  agent_name: string;
  product_id: string;
  product_name: string;
  channel_id: string;
  channel_name: string;
  creative_type: string;
  expected: boolean;
  filled: boolean;
  status: FillStatus;
  is_late: boolean;
  deadline_at: string;
  deadline_label: string;
  first_filled_at: string | null;
  last_modified_at: string | null;
  record_count: number;
  filled_by: string[];
}

interface LateRankPoint {
  agent_id: string;
  agent_name: string;
  channel_id: string;
  channel_name: string;
  creative_type: string;
  agent_label: string;
  type: '逾期未填' | '逾期已填';
  value: number;
  total_late_count: number;
}

interface FillStatusData {
  dateFrom: string;
  dateTo: string;
  summaryCards: {
    expectedAgentDays: number;
    filledAgentDays: number;
    onTimeFilled: number;
    lateFilled: number;
    overdueMissing: number;
    completionRate: number;
  };
  lateRankSeries: LateRankPoint[];
  detailRows: FillDetailRow[];
  filterOptions: {
    products: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; name: string }>;
    agents: Array<{ id: string; name: string; product_id: string; product_name: string; channel_id: string; channel_name: string }>;
    creativeTypes?: string[];
    filledBy: string[];
    statuses: Array<{ value: FillStatus; label: string }>;
  };
}

interface OverviewDashboardProps {
  scope?: 'admin' | 'agent';
  fixedProductId?: string;
  fixedChannelId?: string;
  fixedAgentId?: string;
  fixedProductName?: string;
  fixedChannelName?: string;
  fixedAgentName?: string;
}

const STATUS_META: Record<FillStatus, { color: string; label: string; order: number }> = {
  missing: { color: 'red', label: '逾期未填', order: 0 },
  pending: { color: 'blue', label: '待填', order: 1 },
  late: { color: 'orange', label: '逾期已填', order: 2 },
  on_time: { color: 'green', label: '准时已填', order: 3 },
  not_required: { color: 'default', label: '无需填报', order: 4 },
};

function normalizeRange(range: [Dayjs, Dayjs]) {
  const [start, end] = range[0].isAfter(range[1]) ? [range[1], range[0]] : range;
  const days = end.diff(start, 'day') + 1;
  return days > 21 ? [end.subtract(20, 'day'), end] as [Dayjs, Dayjs] : [start, end] as [Dayjs, Dayjs];
}

function timeText(value: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

function statusTag(status: FillStatus) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function compareText(left?: string | null, right?: string | null) {
  return String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN');
}

function compareIso(left?: string | null, right?: string | null) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function chartConfig(data: LateRankPoint[]) {
  return {
    data,
    xField: 'value',
    yField: 'agent_label',
    colorField: 'type',
    stack: true,
    height: 330,
    legend: { position: 'bottom' },
    axis: {
      x: { title: '逾期次数', min: 0, labelAutoHide: true },
      y: { title: false, labelAutoHide: false },
    },
    interaction: { tooltip: { marker: false } },
    scale: {
      color: {
        range: ['#f04438', '#f59e0b'],
      },
    },
  };
}

export default function OverviewDashboard({
  scope = 'admin',
  fixedProductId,
  fixedChannelId,
  fixedAgentId,
  fixedProductName,
  fixedChannelName,
  fixedAgentName,
}: OverviewDashboardProps = {}) {
  const isAgentScope = scope === 'agent';
  const defaultDateTo = dayjs().subtract(1, 'day');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([defaultDateTo.subtract(6, 'day'), defaultDateTo]);
  const [productIds, setProductIds] = useState<string[]>(isAgentScope && fixedProductId ? [fixedProductId] : []);
  const [channelIds, setChannelIds] = useState<string[]>(isAgentScope && fixedChannelId ? [fixedChannelId] : []);
  const [agentIds, setAgentIds] = useState<string[]>(isAgentScope && fixedAgentId ? [fixedAgentId] : []);
  const [statuses, setStatuses] = useState<FillStatus[]>([]);
  const [filledBy, setFilledBy] = useState('');
  const [data, setData] = useState<FillStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const effectiveProductIds = useMemo(
    () => (isAgentScope && fixedProductId ? [fixedProductId] : productIds),
    [fixedProductId, isAgentScope, productIds]
  );
  const effectiveChannelIds = useMemo(
    () => (isAgentScope && fixedChannelId ? [fixedChannelId] : channelIds),
    [channelIds, fixedChannelId, isAgentScope]
  );
  const effectiveAgentIds = useMemo(
    () => (isAgentScope && fixedAgentId ? [fixedAgentId] : agentIds),
    [agentIds, fixedAgentId, isAgentScope]
  );

  useEffect(() => {
    if (!isAgentScope) return;
    setProductIds(fixedProductId ? [fixedProductId] : []);
    setChannelIds(fixedChannelId ? [fixedChannelId] : []);
    setAgentIds(fixedAgentId ? [fixedAgentId] : []);
  }, [fixedAgentId, fixedChannelId, fixedProductId, isAgentScope]);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [dateFrom, dateTo] = normalizeRange(dateRange);
      const params = new URLSearchParams({
        dateFrom: dateFrom.format('YYYY-MM-DD'),
        dateTo: dateTo.format('YYYY-MM-DD'),
      });
      if (effectiveProductIds.length > 0) params.set('productIds', effectiveProductIds.join(','));
      if (effectiveChannelIds.length > 0) params.set('channelIds', effectiveChannelIds.join(','));
      if (effectiveAgentIds.length > 0) params.set('agentIds', effectiveAgentIds.join(','));
      if (statuses.length > 0) params.set('statuses', statuses.join(','));
      if (filledBy.trim()) params.set('filledBy', filledBy.trim());

      const response = await fetch(`/api/fill-status?${params.toString()}`);
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || '加载失败');
      }
      setData(payload.data);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载填报看板失败');
    } finally {
      setLoading(false);
    }
  }, [dateRange, effectiveAgentIds, effectiveChannelIds, effectiveProductIds, filledBy, messageApi, statuses]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const filteredAgents = useMemo(() => {
    const agents = data?.filterOptions.agents || [];
    return agents
      .filter((agent) => productIds.length === 0 || productIds.includes(agent.product_id))
      .filter((agent) => channelIds.length === 0 || channelIds.includes(agent.channel_id));
  }, [channelIds, data?.filterOptions.agents, productIds]);

  useEffect(() => {
    if (isAgentScope || agentIds.length === 0) return;
    const availableAgentIds = new Set(filteredAgents.map((agent) => agent.id));
    const nextAgentIds = agentIds.filter((agentId) => availableAgentIds.has(agentId));
    if (nextAgentIds.length !== agentIds.length) {
      setAgentIds(nextAgentIds);
    }
  }, [agentIds, filteredAgents, isAgentScope]);

  const columns: TableColumnsType<FillDetailRow> = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 122,
      fixed: 'left',
      sorter: { compare: (left, right) => compareText(left.date, right.date), multiple: 5 },
      defaultSortOrder: 'descend',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '产品',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 130,
      sorter: { compare: (left, right) => compareText(left.product_name, right.product_name), multiple: 4 },
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '渠道',
      dataIndex: 'channel_name',
      key: 'channel_name',
      width: 120,
      sorter: { compare: (left, right) => compareText(left.channel_name, right.channel_name), multiple: 3 },
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '体裁',
      dataIndex: 'creative_type',
      key: 'creative_type',
      width: 120,
      sorter: { compare: (left, right) => compareText(left.creative_type, right.creative_type), multiple: 3 },
      render: (value: string) => <Tag color="purple">{value || '-'}</Tag>,
    },
    {
      title: '代理',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 170,
      sorter: { compare: (left, right) => compareText(left.agent_name, right.agent_name), multiple: 2 },
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '填报状态',
      dataIndex: 'status',
      key: 'status',
      width: 126,
      sorter: { compare: (left, right) => STATUS_META[left.status].order - STATUS_META[right.status].order, multiple: 4 },
      defaultSortOrder: 'ascend',
      render: statusTag,
    },
    {
      title: '截止时间',
      dataIndex: 'deadline_label',
      key: 'deadline_label',
      width: 160,
      sorter: (left, right) => compareIso(left.deadline_at, right.deadline_at),
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
    {
      title: '首条填报时间',
      dataIndex: 'first_filled_at',
      key: 'first_filled_at',
      width: 168,
      sorter: (left, right) => compareIso(left.first_filled_at, right.first_filled_at),
      render: (value: string | null, row) => (
        <Text type={row.status === 'late' ? 'danger' : undefined}>{timeText(value)}</Text>
      ),
    },
    {
      title: '最后修改时间',
      dataIndex: 'last_modified_at',
      key: 'last_modified_at',
      width: 168,
      sorter: (left, right) => compareIso(left.last_modified_at, right.last_modified_at),
      render: timeText,
    },
    {
      title: '填报行数',
      dataIndex: 'record_count',
      key: 'record_count',
      width: 112,
      align: 'right',
      sorter: (left, right) => left.record_count - right.record_count,
      render: (value: number) => <Tag color={value > 0 ? 'blue' : 'default'}>{value}</Tag>,
    },
    {
      title: '填写人',
      dataIndex: 'filled_by',
      key: 'filled_by',
      width: 220,
      sorter: (left, right) => compareText(left.filled_by.join('、'), right.filled_by.join('、')),
      render: (value: string[]) => value.length > 0 ? value.join('、') : '-',
    },
  ];
  const resizableColumns = useResizableColumns(
    isAgentScope ? 'agent-fill-dashboard-columns' : 'admin-fill-dashboard-columns',
    columns
  );

  const summaryCards = data?.summaryCards;

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="mbi-dashboard-shell">
          <div className="hero-row">
            <div>
              <Tag color="blue">填报看板</Tag>
              <Title level={2} style={{ marginTop: 10, marginBottom: 6 }}>
                <BarChartOutlined /> {isAgentScope ? '填报逾期情况' : 'MBI 填报过程仪表盘'}
              </Title>
              <Paragraph className="hero-text">
                {isAgentScope
                  ? '当前页面只展示本公司 T-1 填报状态、截止时间和逾期情况。'
                  : '统一筛选填报状态、截止时间和填写人，聚焦代理是否按时完成 T-1 数据提交。'}
              </Paragraph>
            </div>
            <Button icon={<ReloadOutlined />} onClick={fetchStatus}>刷新</Button>
          </div>
        </Card>

        <Card className="section-card" title="全局筛选器">
          <div className="mbi-filter-group">
            <Space wrap>
              <RangePicker
                value={dateRange}
                allowClear={false}
                onChange={(value) => {
                  if (value?.[0] && value?.[1]) {
                    setDateRange(normalizeRange([value[0], value[1]]));
                  }
                }}
              />
              {isAgentScope ? (
                <>
                  <Tag color="purple">产品：{fixedProductName || data?.filterOptions.products[0]?.name || '-'}</Tag>
                  <Tag color="blue">渠道：{fixedChannelName || data?.filterOptions.channels[0]?.name || '-'}</Tag>
                  <Tag color="geekblue">代理商：{fixedAgentName || data?.filterOptions.agents[0]?.name || '-'}</Tag>
                </>
              ) : (
                <>
                  <MbiMultiSelect
                    placeholder="产品"
                    value={productIds}
                    style={{ minWidth: 190 }}
                    onChange={(value) => setProductIds(value)}
                    options={(data?.filterOptions.products || []).map((product) => ({ value: product.id, label: product.name }))}
                  />
                  <MbiMultiSelect
                    placeholder="渠道"
                    value={channelIds}
                    style={{ minWidth: 190 }}
                    onChange={(value) => setChannelIds(value)}
                    options={(data?.filterOptions.channels || []).map((channel) => ({ value: channel.id, label: channel.name }))}
                  />
                  <MbiMultiSelect
                    placeholder="代理商"
                    value={agentIds}
                    style={{ minWidth: 260 }}
                    onChange={(value) => setAgentIds(value)}
                    options={filteredAgents.map((agent) => ({ value: agent.id, label: `${agent.product_name} / ${agent.channel_name} / ${agent.name}` }))}
                  />
                </>
              )}
              <MbiMultiSelect
                placeholder="填报状态"
                value={statuses}
                style={{ minWidth: 250 }}
                onChange={(value) => setStatuses(value.filter((status): status is FillStatus => status in STATUS_META))}
                options={(data?.filterOptions.statuses || []).map((status) => ({ value: status.value, label: status.label }))}
              />
              <Input
                allowClear
                placeholder="填写人"
                value={filledBy}
                style={{ width: 220 }}
                onChange={(event) => setFilledBy(event.target.value)}
              />
            </Space>
            <Text type="secondary">日期范围最多返回 21 天；产品、渠道、代理、状态、填写人会同时作用于卡片、直方图和明细表。</Text>
          </div>
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="应填体裁天数" value={summaryCards?.expectedAgentDays || 0} />
              <Text type="secondary">在投体裁 × 日期</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="已填体裁天数" value={summaryCards?.filledAgentDays || 0} />
              <Text type="secondary">至少 1 行提交记录</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="准时已填" value={summaryCards?.onTimeFilled || 0} />
              <Text type="secondary">不晚于 D+1 12:00</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="逾期已填" value={summaryCards?.lateFilled || 0} />
              <Text type="secondary">已填但超过截止</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="逾期未填" value={summaryCards?.overdueMissing || 0} />
              <Text type="secondary">已过截止且无记录</Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="填报完成率" value={summaryCards?.completionRate || 0} suffix="%" />
              <Progress percent={summaryCards?.completionRate || 0} showInfo={false} size="small" />
              <Text type="secondary">{summaryCards?.filledAgentDays || 0}/{summaryCards?.expectedAgentDays || 0}</Text>
            </Card>
          </Col>
        </Row>

        <Card className="section-card" title="逾期排行榜">
          {data && data.lateRankSeries.length > 0 ? (
            <Bar {...chartConfig(data.lateRankSeries)} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下暂无逾期代理" />
          )}
        </Card>

        <Card className="section-card" title="填报明细表">
          <Table
            rowKey="id"
            loading={loading}
            dataSource={data?.detailRows || []}
            columns={resizableColumns}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            locale={{ emptyText: '当前筛选下暂无应填体裁。' }}
            scroll={{ x: 1670 }}
          />
        </Card>
      </div>
    </>
  );
}
