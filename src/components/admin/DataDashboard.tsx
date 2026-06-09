'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { UploadProps } from 'antd';
import dayjs from 'dayjs';
import { AreaChartOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import MbiMultiSelect from '@/components/admin/MbiMultiSelect';
import { useResizableColumns } from '@/components/common/useResizableColumns';

const Line = dynamic(async () => (await import('@ant-design/charts')).Line as React.ComponentType<Record<string, unknown>>, { ssr: false });

const { RangePicker } = DatePicker;
const { Title, Paragraph, Text } = Typography;

type MetricKey = 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7';
type Operator = '<' | '<=' | '=' | '>' | '>=';
type SummaryMode = 'auto' | 'total' | 'date' | 'product' | 'channel' | 'agent' | 'creative' | 'promotion_goal';
type AggregateMethod = 'auto' | 'sum' | 'avg' | 'max' | 'min';

interface MetricFilter {
  id: string;
  metric: MetricKey;
  operator: Operator;
  value: number | null;
}

interface DetailRow {
  id: string;
  agent_id: string;
  product_id: string;
  channel_id: string;
  record_date: string;
  product_name: string;
  channel_name: string;
  agent_name: string;
  creative_type: string;
  promotion_goal: string;
  cost: number;
  cost_dod: number | null;
  activations: number;
  activations_dod: number | null;
  cpa: number | null;
  target_cpa: number | null;
  cpa_dod: number | null;
  cpa_wow: number | null;
  cpa_target_deviation: number | null;
  retention_day1: number | null;
  target_retention_day1: number | null;
  retention_day1_dod: number | null;
  retention_day1_wow: number | null;
  retention_day1_target_deviation: number | null;
  retention_day7: number | null;
  target_retention_day7: number | null;
  retention_day7_dod: number | null;
  retention_day7_wow: number | null;
  retention_day7_target_deviation: number | null;
  ctr: number | null;
  cvr: number | null;
  cpm: number | null;
  activation_cap: number | null;
  redline_cpa: boolean;
  redline_retention_day1: boolean;
  redline_retention_day7: boolean;
  redline_count: number;
  has_redline: boolean;
  isSummary?: boolean;
  summaryCount?: number;
  cpaRedlineCount?: number;
  day1RedlineCount?: number;
  day7RedlineCount?: number;
}

interface ChartPoint {
  date: string;
  dateLabel: string;
  series: string;
  value: number | null;
}

interface AnalyticsData {
  dateFrom: string;
  dateTo: string;
  summaryCards: {
    totalCost: number;
    totalActivations: number;
    cpa: number | null;
    retentionDay1: number | null;
    retentionDay7: number | null;
  };
  fillProgress: {
    expectedAgents: number;
    filledAgents: number;
    fillRate: number;
  };
  chartSeries: {
    costTrend: ChartPoint[];
    activationTrend: ChartPoint[];
    cpaTrend: ChartPoint[];
    cpaAlertTrend: ChartPoint[];
    retentionDay1Trend: ChartPoint[];
    retentionDay1AlertTrend: ChartPoint[];
    retentionDay7Trend: ChartPoint[];
    retentionDay7AlertTrend: ChartPoint[];
  };
  detailRows: DetailRow[];
  detailSummary: DetailRow | null;
  pagination: {
    total: number;
    current: number;
    pageSize: number;
  };
  filterOptions: {
    products: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; name: string }>;
    agents: Array<{ id: string; name: string; product_id: string; product_name: string; channel_id: string; channel_name: string }>;
    creativeTypes: string[];
    promotionGoals: string[];
  };
}

interface DataDashboardProps {
  scope?: 'admin' | 'agent';
  fixedProductId?: string;
  fixedChannelId?: string;
  fixedAgentId?: string;
  fixedProductName?: string;
  fixedChannelName?: string;
  fixedAgentName?: string;
}

const METRIC_OPTIONS = [
  { value: 'cost', label: '消耗' },
  { value: 'activations', label: '激活' },
  { value: 'cpa', label: 'CPA' },
  { value: 'retention_day1', label: '次留' },
  { value: 'retention_day7', label: '7留' },
];

const OPERATOR_OPTIONS = ['<', '<=', '=', '>', '>='].map((value) => ({ value, label: value }));
const MAX_METRIC_FILTERS = METRIC_OPTIONS.length;
const DEFAULT_TABLE_PAGE_SIZE = 100;

function money(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function numberText(value: number | null | undefined, precision = 2) {
  return value == null ? '-' : Number(value).toFixed(precision);
}

function pct(value: number | null | undefined) {
  return value == null ? '-' : `${Number(value).toFixed(1)}%`;
}

function deltaPct(value: number | null | undefined) {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function sortableText(key: keyof DetailRow) {
  return (left: DetailRow, right: DetailRow) => String(left[key] || '').localeCompare(String(right[key] || ''), 'zh-Hans-CN');
}

function sortableNumber(key: keyof DetailRow) {
  return (left: DetailRow, right: DetailRow) => Number(left[key] ?? Number.NEGATIVE_INFINITY) - Number(right[key] ?? Number.NEGATIVE_INFINITY);
}

function redlineTags(row: DetailRow) {
  const tags = [];
  const cpaCount = row.isSummary ? row.cpaRedlineCount || 0 : Number(row.redline_cpa);
  const day1Count = row.isSummary ? row.day1RedlineCount || 0 : Number(row.redline_retention_day1);
  const day7Count = row.isSummary ? row.day7RedlineCount || 0 : Number(row.redline_retention_day7);
  if (cpaCount > 0) tags.push(<Tag key="cpa" color="red">CPA超线{row.isSummary ? `×${cpaCount}` : ''}</Tag>);
  if (day1Count > 0) tags.push(<Tag key="day1" color="red">次留破线{row.isSummary ? `×${day1Count}` : ''}</Tag>);
  if (day7Count > 0) tags.push(<Tag key="day7" color="red">7留破线{row.isSummary ? `×${day7Count}` : ''}</Tag>);
  return tags.length > 0 ? <Space wrap>{tags}</Space> : <Tag color="green">达标</Tag>;
}

function aggregate(values: Array<number | null>, method: AggregateMethod) {
  const numbers = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (numbers.length === 0) return null;
  if (method === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
  if (method === 'max') return Math.max(...numbers);
  if (method === 'min') return Math.min(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function weightedMetric(rows: DetailRow[], key: 'retention_day1' | 'retention_day7') {
  const weighted = rows.filter((row) => row[key] != null && row.activations > 0);
  const totalWeight = weighted.reduce((sum, row) => sum + row.activations, 0);
  if (totalWeight > 0) {
    return weighted.reduce((sum, row) => sum + (row[key] || 0) * row.activations, 0) / totalWeight;
  }
  return aggregate(rows.map((row) => row[key]), 'avg');
}

function aggregateRows(rows: DetailRow[], mode: SummaryMode, method: AggregateMethod) {
  if (mode === 'auto') return rows;
  const groups = new Map<string, DetailRow[]>();
  for (const row of rows) {
    const key = mode === 'total'
      ? '总计'
      : mode === 'date'
        ? row.record_date
        : mode === 'product'
          ? row.product_name
          : mode === 'channel'
            ? row.channel_name
            : mode === 'agent'
              ? `${row.product_name}/${row.channel_name}/${row.agent_name}`
              : mode === 'creative'
                ? row.creative_type
                : row.promotion_goal;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const totalCost = group.reduce((sum, row) => sum + row.cost, 0);
    const totalActivations = group.reduce((sum, row) => sum + row.activations, 0);
    const auto = method === 'auto';
    const cpa = auto ? (totalActivations > 0 ? totalCost / totalActivations : null) : aggregate(group.map((row) => row.cpa), method);
    return {
      id: `summary:${mode}:${key}`,
      agent_id: '',
      product_id: '',
      channel_id: '',
      record_date: mode === 'date' ? key : mode === 'total' ? '总计' : '',
      product_name: mode === 'product' ? key : mode === 'agent' ? group[0].product_name : '',
      channel_name: mode === 'channel' ? key : mode === 'agent' ? group[0].channel_name : '',
      agent_name: mode === 'agent' ? group[0].agent_name : '',
      creative_type: mode === 'creative' ? key : '',
      promotion_goal: mode === 'promotion_goal' ? key : '',
      cost: method === 'auto' || method === 'sum' ? totalCost : aggregate(group.map((row) => row.cost), method) || 0,
      cost_dod: aggregate(group.map((row) => row.cost_dod), auto ? 'avg' : method),
      activations: method === 'auto' || method === 'sum' ? totalActivations : aggregate(group.map((row) => row.activations), method) || 0,
      activations_dod: aggregate(group.map((row) => row.activations_dod), auto ? 'avg' : method),
      cpa,
      target_cpa: aggregate(group.map((row) => row.target_cpa), auto ? 'avg' : method),
      cpa_dod: aggregate(group.map((row) => row.cpa_dod), auto ? 'avg' : method),
      cpa_wow: aggregate(group.map((row) => row.cpa_wow), auto ? 'avg' : method),
      cpa_target_deviation: aggregate(group.map((row) => row.cpa_target_deviation), auto ? 'avg' : method),
      retention_day1: auto ? weightedMetric(group, 'retention_day1') : aggregate(group.map((row) => row.retention_day1), method),
      target_retention_day1: aggregate(group.map((row) => row.target_retention_day1), auto ? 'avg' : method),
      retention_day1_dod: aggregate(group.map((row) => row.retention_day1_dod), auto ? 'avg' : method),
      retention_day1_wow: aggregate(group.map((row) => row.retention_day1_wow), auto ? 'avg' : method),
      retention_day1_target_deviation: aggregate(group.map((row) => row.retention_day1_target_deviation), auto ? 'avg' : method),
      retention_day7: auto ? weightedMetric(group, 'retention_day7') : aggregate(group.map((row) => row.retention_day7), method),
      target_retention_day7: aggregate(group.map((row) => row.target_retention_day7), auto ? 'avg' : method),
      retention_day7_dod: aggregate(group.map((row) => row.retention_day7_dod), auto ? 'avg' : method),
      retention_day7_wow: aggregate(group.map((row) => row.retention_day7_wow), auto ? 'avg' : method),
      retention_day7_target_deviation: aggregate(group.map((row) => row.retention_day7_target_deviation), auto ? 'avg' : method),
      ctr: aggregate(group.map((row) => row.ctr), auto ? 'avg' : method),
      cvr: aggregate(group.map((row) => row.cvr), auto ? 'avg' : method),
      cpm: aggregate(group.map((row) => row.cpm), auto ? 'avg' : method),
      activation_cap: aggregate(group.map((row) => row.activation_cap), auto ? 'avg' : method),
      redline_cpa: group.some((row) => row.redline_cpa),
      redline_retention_day1: group.some((row) => row.redline_retention_day1),
      redline_retention_day7: group.some((row) => row.redline_retention_day7),
      redline_count: group.reduce((sum, row) => sum + row.redline_count, 0),
      has_redline: group.some((row) => row.has_redline),
      isSummary: true,
      summaryCount: group.length,
      cpaRedlineCount: group.filter((row) => row.redline_cpa).length,
      day1RedlineCount: group.filter((row) => row.redline_retention_day1).length,
      day7RedlineCount: group.filter((row) => row.redline_retention_day7).length,
    } satisfies DetailRow;
  });
}

function chartConfig(data: ChartPoint[]) {
  return {
    data: data.filter((item) => item.value != null),
    xField: 'dateLabel',
    yField: 'value',
    colorField: 'series',
    height: 178,
    smooth: true,
    point: false,
    legend: { position: 'bottom' },
    axis: { y: { labelAutoHide: true }, x: { labelAutoHide: true } },
  };
}

function readListParam(searchParams: Pick<URLSearchParams, 'get' | 'getAll'>, key: string) {
  const values = searchParams.getAll(key).length > 0
    ? searchParams.getAll(key)
    : [searchParams.get(key) || ''];
  return Array.from(new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)));
}

function readDateParam(value: string | null) {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function defaultDateRange(): [dayjs.Dayjs, dayjs.Dayjs] {
  return [dayjs().subtract(21, 'day'), dayjs().subtract(1, 'day')];
}

function readDateRangeParam(searchParams: Pick<URLSearchParams, 'get'>): [dayjs.Dayjs, dayjs.Dayjs] {
  const dateFrom = readDateParam(searchParams.get('dateFrom'));
  const dateTo = readDateParam(searchParams.get('dateTo'));
  return dateFrom && dateTo ? [dateFrom, dateTo] : defaultDateRange();
}

export default function DataDashboard({
  scope = 'admin',
  fixedProductId,
  fixedChannelId,
  fixedAgentId,
  fixedProductName,
  fixedChannelName,
  fixedAgentName,
}: DataDashboardProps = {}) {
  const isAgentScope = scope === 'agent';
  const searchParams = useSearchParams();
  const searchSignature = searchParams.toString();
  const appliedSearchSignatureRef = useRef(searchSignature);
  const requestSeqRef = useRef(0);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => readDateRangeParam(searchParams));
  const [productIds, setProductIds] = useState<string[]>(() => (
    isAgentScope && fixedProductId ? [fixedProductId] : readListParam(searchParams, 'productIds')
  ));
  const [channelIds, setChannelIds] = useState<string[]>(() => (
    isAgentScope && fixedChannelId ? [fixedChannelId] : readListParam(searchParams, 'channelIds')
  ));
  const [agentIds, setAgentIds] = useState<string[]>(() => (
    isAgentScope && fixedAgentId ? [fixedAgentId] : readListParam(searchParams, 'agentIds')
  ));
  const [creativeTypes, setCreativeTypes] = useState<string[]>(() => readListParam(searchParams, 'creativeTypes'));
  const [promotionGoals, setPromotionGoals] = useState<string[]>(() => readListParam(searchParams, 'promotionGoals'));
  const [metricFilters, setMetricFilters] = useState<MetricFilter[]>([
    { id: 'default:cpa', metric: 'cpa', operator: '>', value: null },
  ]);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('auto');
  const [aggregateMethod, setAggregateMethod] = useState<AggregateMethod>('auto');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [tablePagination, setTablePagination] = useState({ current: 1, pageSize: DEFAULT_TABLE_PAGE_SIZE });
  const [messageApi, contextHolder] = message.useMessage();

  const completeMetricFilters = useMemo(() => (
    metricFilters.filter((filter) => filter.value != null && Number.isFinite(filter.value))
  ), [metricFilters]);
  const effectiveChannelIds = useMemo(
    () => (isAgentScope && fixedChannelId ? [fixedChannelId] : channelIds),
    [channelIds, fixedChannelId, isAgentScope]
  );
  const effectiveProductIds = useMemo(
    () => (isAgentScope && fixedProductId ? [fixedProductId] : productIds),
    [fixedProductId, isAgentScope, productIds]
  );
  const effectiveAgentIds = useMemo(
    () => (isAgentScope && fixedAgentId ? [fixedAgentId] : agentIds),
    [agentIds, fixedAgentId, isAgentScope]
  );
  const tablePageCurrent = tablePagination.current;
  const tablePageSize = tablePagination.pageSize;

  useEffect(() => {
    if (!isAgentScope) return;
    setProductIds(fixedProductId ? [fixedProductId] : []);
    setChannelIds(fixedChannelId ? [fixedChannelId] : []);
    setAgentIds(fixedAgentId ? [fixedAgentId] : []);
  }, [fixedAgentId, fixedChannelId, fixedProductId, isAgentScope]);

  useEffect(() => {
    if (appliedSearchSignatureRef.current === searchSignature) return;
    appliedSearchSignatureRef.current = searchSignature;

    setDateRange(readDateRangeParam(searchParams));
    setCreativeTypes(readListParam(searchParams, 'creativeTypes'));
    setPromotionGoals(readListParam(searchParams, 'promotionGoals'));

    if (!isAgentScope) {
      setProductIds(readListParam(searchParams, 'productIds'));
      setChannelIds(readListParam(searchParams, 'channelIds'));
      setAgentIds(readListParam(searchParams, 'agentIds'));
    }
  }, [isAgentScope, searchParams, searchSignature]);

  useEffect(() => {
    setTablePagination((current) => (
      current.current === 1 ? current : { ...current, current: 1 }
    ));
  }, [completeMetricFilters, creativeTypes, dateRange, effectiveAgentIds, effectiveChannelIds, effectiveProductIds, promotionGoals]);

  const fetchData = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom: dateRange[0].format('YYYY-MM-DD'),
        dateTo: dateRange[1].format('YYYY-MM-DD'),
        page: String(tablePageCurrent),
        pageSize: String(tablePageSize),
      });
      if (effectiveProductIds.length > 0) params.set('productIds', effectiveProductIds.join(','));
      if (effectiveChannelIds.length > 0) params.set('channelIds', effectiveChannelIds.join(','));
      if (effectiveAgentIds.length > 0) params.set('agentIds', effectiveAgentIds.join(','));
      if (creativeTypes.length > 0) params.set('creativeTypes', creativeTypes.join(','));
      if (promotionGoals.length > 0) params.set('promotionGoals', promotionGoals.join(','));
      if (completeMetricFilters.length > 0) {
        params.set('metricFilters', JSON.stringify(completeMetricFilters.map(({ metric, operator, value }) => ({ metric, operator, value }))));
      }

      const response = await fetch(`/api/analytics?${params.toString()}`);
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || '加载失败');
      if (requestSeq !== requestSeqRef.current) return;
      setData(payload.data);
    } catch (error) {
      if (requestSeq !== requestSeqRef.current) return;
      messageApi.error(error instanceof Error ? error.message : '加载数据看板失败');
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [completeMetricFilters, creativeTypes, dateRange, effectiveAgentIds, effectiveChannelIds, effectiveProductIds, messageApi, promotionGoals, tablePageCurrent, tablePageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (isAgentScope || channelIds.length === 0) return;
    setAgentIds((current) => {
      const next = current.filter((id) => {
        const agent = data?.filterOptions.agents.find((item) => item.id === id);
        return agent ? (channelIds.includes(agent.channel_id) && (productIds.length === 0 || productIds.includes(agent.product_id))) : true;
      }).filter((id, index, items) => items.indexOf(id) === index);
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current;
      }
      return next;
    });
  }, [channelIds, data?.filterOptions.agents, isAgentScope, productIds]);

  const filteredAgents = useMemo(() => (
    (data?.filterOptions.agents || [])
      .filter((agent) => productIds.length === 0 || productIds.includes(agent.product_id))
      .filter((agent) => channelIds.length === 0 || channelIds.includes(agent.channel_id))
  ), [channelIds, data?.filterOptions.agents, productIds]);
  const productOptions = useMemo(
    () => (data?.filterOptions.products || []).map((product) => ({ value: product.id, label: product.name })),
    [data?.filterOptions.products]
  );
  const channelOptions = useMemo(
    () => (data?.filterOptions.channels || []).map((channel) => ({ value: channel.id, label: channel.name })),
    [data?.filterOptions.channels]
  );
  const creativeTypeOptions = useMemo(
    () => (data?.filterOptions.creativeTypes || []).map((item) => ({ value: item, label: item })),
    [data?.filterOptions.creativeTypes]
  );
  const promotionGoalOptions = useMemo(
    () => (data?.filterOptions.promotionGoals || []).map((item) => ({ value: item, label: item })),
    [data?.filterOptions.promotionGoals]
  );
  const agentOptions = useMemo(
    () => filteredAgents.map((agent) => ({ value: agent.id, label: `${agent.product_name} / ${agent.channel_name} / ${agent.name}` })),
    [filteredAgents]
  );
  const usedMetricSet = useMemo(() => new Set(metricFilters.map((filter) => filter.metric)), [metricFilters]);

  const tableRows = useMemo(() => aggregateRows(data?.detailRows || [], summaryMode, aggregateMethod), [aggregateMethod, data?.detailRows, summaryMode]);
  const summary = data?.detailSummary || null;

  const addMetricFilter = () => {
    setMetricFilters((current) => {
      if (current.length >= MAX_METRIC_FILTERS) {
        messageApi.warning('指标筛选项最多同时设置 5 个条件');
        return current;
      }

      const used = new Set(current.map((filter) => filter.metric));
      const nextMetric = METRIC_OPTIONS.find((option) => !used.has(option.value as MetricKey))?.value as MetricKey | undefined;
      if (!nextMetric) {
        messageApi.warning('5 个指标都已设置筛选条件');
        return current;
      }

      return [...current, { id: `${Date.now()}:${current.length}`, metric: nextMetric, operator: '>', value: null }];
    });
  };

  const updateMetricFilter = (id: string, patch: Partial<MetricFilter>) => {
    setMetricFilters((current) => {
      if (patch.metric && current.some((filter) => filter.id !== id && filter.metric === patch.metric)) {
        messageApi.warning('每个指标最多设置一个筛选条件');
        return current;
      }
      return current.map((filter) => filter.id === id ? { ...filter, ...patch } : filter);
    });
  };

  const importProps: UploadProps = {
    maxCount: 1,
    showUploadList: false,
    accept: '.csv,text/csv',
    beforeUpload: async (file) => {
      setImporting(true);
      try {
        const csvText = await file.text();
        const response = await fetch('/api/import/mock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText }),
        });
        const payload = await response.json();
        const errors = payload.data?.errors || [];
        const credentials = payload.data?.createdCredentials || [];
        if (payload.success) {
          messageApi.success(payload.message || '历史 T-1 数据已导入');
          if (credentials.length > 0) {
            Modal.info({
              title: '导入时自动创建了代理账号',
              content: (
                <div className="compact-list" style={{ marginTop: 8 }}>
                  <Text type="secondary">请保存以下账号密码，关闭后不再展示明文密码。</Text>
                  {credentials.map((item: { username: string; password: string }) => (
                    <Text key={item.username}>
                      <Text code>{item.username}</Text> / <Text code>{item.password}</Text>
                    </Text>
                  ))}
                </div>
              ),
            });
          }
          fetchData();
        } else {
          Modal.warning({
            title: '历史数据导入存在错误',
            content: (
              <div className="compact-list" style={{ marginTop: 8 }}>
                {errors.length > 0 ? errors.slice(0, 12).map((error: string) => (
                  <Text key={error} type="danger">{error}</Text>
                )) : <Text>{payload.error || '导入失败'}</Text>}
              </div>
            ),
          });
        }
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : '导入失败');
      } finally {
        setImporting(false);
      }
      return false;
    },
  };

  const columns = [
    {
      title: '日期',
      dataIndex: 'record_date',
      key: 'record_date',
      width: 112,
      fixed: 'left' as const,
      sorter: sortableText('record_date'),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '产品',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 126,
      sorter: sortableText('product_name'),
      render: (value: string) => value ? <Tag color="blue">{value}</Tag> : '-',
    },
    {
      title: '渠道',
      dataIndex: 'channel_name',
      key: 'channel_name',
      width: 112,
      sorter: sortableText('channel_name'),
      render: (value: string) => value ? <Tag>{value}</Tag> : '-',
    },
    {
      title: '体裁',
      dataIndex: 'creative_type',
      key: 'creative_type',
      width: 110,
      sorter: sortableText('creative_type'),
      render: (value: string) => value || '-',
    },
    {
      title: '投放目标',
      dataIndex: 'promotion_goal',
      key: 'promotion_goal',
      width: 110,
      sorter: sortableText('promotion_goal'),
      render: (value: string) => value || '-',
    },
    {
      title: '代理商',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 150,
      sorter: sortableText('agent_name'),
      render: (value: string, row: DetailRow) => row.isSummary ? value || <Text type="secondary">汇总</Text> : <Text strong>{value}</Text>,
    },
    { title: '消耗', dataIndex: 'cost', key: 'cost', width: 112, sorter: sortableNumber('cost'), render: (value: number) => money(value) },
    { title: '消耗日环比', dataIndex: 'cost_dod', key: 'cost_dod', width: 122, sorter: sortableNumber('cost_dod'), render: deltaPct },
    { title: '激活', dataIndex: 'activations', key: 'activations', width: 96, sorter: sortableNumber('activations') },
    { title: '激活日环比', dataIndex: 'activations_dod', key: 'activations_dod', width: 122, sorter: sortableNumber('activations_dod'), render: deltaPct },
    { title: 'CPA', dataIndex: 'cpa', key: 'cpa', width: 90, sorter: sortableNumber('cpa'), render: (value: number | null) => numberText(value) },
    { title: '考核CPA', dataIndex: 'target_cpa', key: 'target_cpa', width: 104, sorter: sortableNumber('target_cpa'), render: (value: number | null) => numberText(value) },
    { title: '差异百分比', dataIndex: 'cpa_target_deviation', key: 'cpa_target_deviation', width: 120, sorter: sortableNumber('cpa_target_deviation'), render: deltaPct },
    { title: 'CPA日环比', dataIndex: 'cpa_dod', key: 'cpa_dod', width: 120, sorter: sortableNumber('cpa_dod'), render: deltaPct },
    { title: 'CPA周同比', dataIndex: 'cpa_wow', key: 'cpa_wow', width: 120, sorter: sortableNumber('cpa_wow'), render: deltaPct },
    { title: 'CTR', dataIndex: 'ctr', key: 'ctr', width: 86, sorter: sortableNumber('ctr'), render: pct },
    { title: 'CVR', dataIndex: 'cvr', key: 'cvr', width: 86, sorter: sortableNumber('cvr'), render: pct },
    { title: 'CPM', dataIndex: 'cpm', key: 'cpm', width: 94, sorter: sortableNumber('cpm'), render: (value: number | null) => numberText(value) },
    { title: '次留', dataIndex: 'retention_day1', key: 'retention_day1', width: 90, sorter: sortableNumber('retention_day1'), render: pct },
    { title: '考核次留', dataIndex: 'target_retention_day1', key: 'target_retention_day1', width: 110, sorter: sortableNumber('target_retention_day1'), render: pct },
    { title: '差异百分比', dataIndex: 'retention_day1_target_deviation', key: 'retention_day1_target_deviation', width: 120, sorter: sortableNumber('retention_day1_target_deviation'), render: deltaPct },
    { title: '次留日环比', dataIndex: 'retention_day1_dod', key: 'retention_day1_dod', width: 122, sorter: sortableNumber('retention_day1_dod'), render: deltaPct },
    { title: '次留周同比', dataIndex: 'retention_day1_wow', key: 'retention_day1_wow', width: 122, sorter: sortableNumber('retention_day1_wow'), render: deltaPct },
    { title: '7留', dataIndex: 'retention_day7', key: 'retention_day7', width: 90, sorter: sortableNumber('retention_day7'), render: pct },
    { title: '考核7留', dataIndex: 'target_retention_day7', key: 'target_retention_day7', width: 110, sorter: sortableNumber('target_retention_day7'), render: pct },
    { title: '差异百分比', dataIndex: 'retention_day7_target_deviation', key: 'retention_day7_target_deviation', width: 120, sorter: sortableNumber('retention_day7_target_deviation'), render: deltaPct },
    { title: '7留日环比', dataIndex: 'retention_day7_dod', key: 'retention_day7_dod', width: 122, sorter: sortableNumber('retention_day7_dod'), render: deltaPct },
    { title: '7留周同比', dataIndex: 'retention_day7_wow', key: 'retention_day7_wow', width: 122, sorter: sortableNumber('retention_day7_wow'), render: deltaPct },
    { title: '激活量级上限', dataIndex: 'activation_cap', key: 'activation_cap', width: 128, sorter: sortableNumber('activation_cap'), render: (value: number | null) => value == null ? '-' : money(value) },
    { title: '红线状态', key: 'redline', width: 230, sorter: sortableNumber('redline_count'), render: (_: unknown, row: DetailRow) => redlineTags(row) },
  ];
  const resizableColumns = useResizableColumns(
    isAgentScope ? 'agent-data-dashboard-columns' : 'admin-data-dashboard-columns',
    columns
  );

  const chartCards = [
    { title: '消耗趋势', data: data?.chartSeries.costTrend || [] },
    { title: '激活趋势', data: data?.chartSeries.activationTrend || [] },
    { title: 'CPA趋势', data: data?.chartSeries.cpaTrend || [] },
    { title: 'CPA异常数量', data: data?.chartSeries.cpaAlertTrend || [] },
    { title: '次留趋势', data: data?.chartSeries.retentionDay1Trend || [] },
    { title: '次留异常数量', data: data?.chartSeries.retentionDay1AlertTrend || [] },
    { title: '7留趋势', data: data?.chartSeries.retentionDay7Trend || [] },
    { title: '7留异常数量', data: data?.chartSeries.retentionDay7AlertTrend || [] },
  ];

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="mbi-dashboard-shell">
          <div className="hero-row">
            <div>
              <Tag color="geekblue">数据看板</Tag>
              <Title level={2} style={{ marginTop: 10, marginBottom: 6 }}>
                <AreaChartOutlined /> {isAgentScope ? '代理数据看板' : 'MBI 投放数据仪表盘'}
              </Title>
              <Paragraph className="hero-text">
                {isAgentScope
                  ? '当前看板已按登录账号固定渠道和代理商，只展示本公司投放数据、趋势与红线。'
                  : '筛选器、KPI、小图矩阵和明细表使用同一份筛选结果，支持快速定位代理与指标红线。'}
              </Paragraph>
            </div>
            <Space wrap>
              {!isAgentScope && (
                <>
                  <Button href="/api/import/template" icon={<DownloadOutlined />}>下载 T-1 模板</Button>
                  <Upload {...importProps}>
                    <Button icon={<UploadOutlined />} loading={importing}>上传历史 T-1 CSV</Button>
                  </Upload>
                </>
              )}
              <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            </Space>
          </div>
        </Card>

        <Card className="section-card" title="全局筛选项">
          <div className="mbi-filter-grid">
            <div className="mbi-filter-group">
              <Text strong>维度筛选项</Text>
              <Space wrap>
                <RangePicker
                  value={dateRange}
                  allowClear={false}
                  onChange={(value) => value && setDateRange([value[0]!, value[1]!])}
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
                      options={productOptions}
                    />
                    <MbiMultiSelect
                      placeholder="渠道"
                      value={channelIds}
                      style={{ minWidth: 190 }}
                      onChange={(value) => setChannelIds(value)}
                      options={channelOptions}
                    />
                  </>
                )}
                <MbiMultiSelect
                  placeholder="体裁"
                  value={creativeTypes}
                  style={{ minWidth: 190 }}
                  onChange={(value) => setCreativeTypes(value)}
                  options={creativeTypeOptions}
                />
                <MbiMultiSelect
                  placeholder="投放目标"
                  value={promotionGoals}
                  style={{ minWidth: 190 }}
                  onChange={(value) => setPromotionGoals(value)}
                  options={promotionGoalOptions}
                />
                {!isAgentScope && (
                  <MbiMultiSelect
                    placeholder="代理商"
                    value={agentIds}
                    style={{ minWidth: 280 }}
                    onChange={(value) => setAgentIds(value)}
                    options={agentOptions}
                  />
                )}
              </Space>
            </div>

            <div className="mbi-filter-group">
              <div className="hero-row">
                <Space>
                  <Text strong>指标筛选项</Text>
                  <Text type="secondary">最多 5 个，消耗/激活/CPA/次留/7留各一个</Text>
                </Space>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={metricFilters.length >= MAX_METRIC_FILTERS}
                  onClick={addMetricFilter}
                >
                  添加条件
                </Button>
              </div>
              <div className="mbi-metric-filter-list">
                {metricFilters.length === 0 ? (
                  <Text type="secondary">未设置指标条件，当前展示全部数据。</Text>
                ) : metricFilters.map((filter) => (
                  <Space key={filter.id} wrap>
                    <Select
                      value={filter.metric}
                      style={{ width: 120 }}
                      onChange={(value) => updateMetricFilter(filter.id, { metric: value })}
                      options={METRIC_OPTIONS.map((option) => ({
                        ...option,
                        disabled: usedMetricSet.has(option.value as MetricKey) && option.value !== filter.metric,
                      }))}
                    />
                    <Select
                      value={filter.operator}
                      style={{ width: 86 }}
                      onChange={(value) => updateMetricFilter(filter.id, { operator: value })}
                      options={OPERATOR_OPTIONS}
                    />
                    <InputNumber
                      value={filter.value}
                      style={{ width: 130 }}
                      placeholder="数值"
                      onChange={(value) => updateMetricFilter(filter.id, { value: value == null ? null : Number(value) })}
                    />
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => setMetricFilters((current) => current.filter((item) => item.id !== filter.id))}
                    />
                  </Space>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}><Statistic title="总消耗" value={data?.summaryCards.totalCost || 0} precision={0} /></Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}><Statistic title="总激活" value={data?.summaryCards.totalActivations || 0} /></Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}><Statistic title="CPA" value={data?.summaryCards.cpa || 0} precision={2} /></Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}><Statistic title="次留" value={data?.summaryCards.retentionDay1 || 0} precision={1} suffix="%" /></Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}><Statistic title="7留" value={data?.summaryCards.retentionDay7 || 0} precision={1} suffix="%" /></Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card className="mbi-kpi-card" loading={loading}>
              <Statistic title="填报进度" value={data?.fillProgress.fillRate || 0} suffix="%" />
              <Progress percent={data?.fillProgress.fillRate || 0} showInfo={false} size="small" />
              <Text type="secondary">{data?.fillProgress.filledAgents || 0}/{data?.fillProgress.expectedAgents || 0}</Text>
            </Card>
          </Col>
        </Row>

        <div className="mbi-chart-grid">
          {chartCards.map((chart) => (
            <Card key={chart.title} className="mbi-chart-card" title={chart.title}>
              {chart.data.length > 0 ? <Line {...chartConfig(chart.data)} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
            </Card>
          ))}
        </div>

        <Card
          className="section-card"
          title="数据明细表"
          extra={(
            <Space wrap>
              <Text type="secondary">汇总分析</Text>
              <Select
                value={summaryMode}
                style={{ width: 150 }}
                onChange={setSummaryMode}
                options={[
                  { value: 'auto', label: '自动（明细+总计）' },
                  { value: 'total', label: '总计' },
                  { value: 'date', label: '按日期小计' },
                  { value: 'product', label: '按产品小计' },
                  { value: 'channel', label: '按渠道小计' },
                  { value: 'agent', label: '按代理商小计' },
                  { value: 'creative', label: '按体裁小计' },
                  { value: 'promotion_goal', label: '按投放目标小计' },
                ]}
              />
              <Select
                value={aggregateMethod}
                style={{ width: 110 }}
                onChange={setAggregateMethod}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'sum', label: '求和' },
                  { value: 'avg', label: '平均' },
                  { value: 'max', label: '最大' },
                  { value: 'min', label: '最小' },
                ]}
              />
            </Space>
          )}
        >
          <div className="table-scroll-shell">
            <Table
              rowKey="id"
              loading={loading}
              dataSource={tableRows}
              columns={resizableColumns}
              pagination={{
                current: data?.pagination.current || tablePagination.current,
                pageSize: data?.pagination.pageSize || tablePagination.pageSize,
                total: data?.pagination.total || 0,
                showSizeChanger: true,
                pageSizeOptions: [50, 100, 200, 500],
                showTotal: (total) => `共 ${total} 行`,
                onChange: (current, pageSize) => setTablePagination({ current, pageSize }),
              }}
              locale={{ emptyText: '当前筛选下暂无数据' }}
              scroll={{ x: 2710 }}
              tableLayout="fixed"
              summary={() => summary ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={6}>
                      <Text strong>总计</Text>
                      <Text type="secondary" style={{ marginLeft: 8 }}>{summary.summaryCount || 0} 行</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6}><Text strong>{money(summary.cost)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={7} />
                    <Table.Summary.Cell index={8}><Text strong>{summary.activations}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={9} />
                    <Table.Summary.Cell index={10}><Text strong>{numberText(summary.cpa)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={11} colSpan={18} />
                    <Table.Summary.Cell index={29}>{redlineTags(summary)}</Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              ) : undefined}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
