'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { AreaChartOutlined, CheckCircleOutlined, CopyOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useResizableColumns } from '@/components/common/useResizableColumns';

const { RangePicker } = DatePicker;
const { Title, Paragraph, Text } = Typography;

type MetricKey = 'cost' | 'activations' | 'cpa' | 'retention_day1' | 'retention_day7';
type AlertMetric = '消耗' | '激活' | 'CPA' | '次留' | '7留';
type AlertType = '日环比偏离' | '周同比偏离' | '考核值偏离';
type AlertStatusFilter = 'all' | 'processed' | 'open';
type AlertStatus = 'open' | 'acknowledged' | 'resolved';
const DAILY_NOTE_PAGE_SIZE = 5;
const DAILY_HIGHLIGHT_EXIT_MS = 280;
const ALERT_DETAIL_PAGE_SIZE = 100;

interface MetricDetail {
  key: MetricKey;
  name: AlertMetric;
  unit: 'number' | 'percent';
  actualValue: number | null;
  targetValue: number | null;
  dod: number | null;
  wow: number | null;
  targetDeviation: number | null;
  hit: boolean;
}

interface AlertRow {
  id: string;
  record_date: string;
  product_name: string;
  channel_name: string;
  creative_type: string;
  agent_name: string;
  feishu_webhook?: string | null;
  status: string;
  metricDetails?: MetricDetail[];
}

interface AlertDetailRow {
  id: string;
  source_alert_id: string;
  date: string;
  product_name: string;
  channel_name: string;
  creative_type: string;
  agent_name: string;
  feishu_webhook: string;
  alert_metric: AlertMetric;
  alert_type: AlertType;
  actual_value: number | null;
  baseline_value: number | null;
  deviation_pct: number | null;
  unit: 'number' | 'percent';
}

interface HighlightItem {
  rank: number;
  alert_id: string;
  alert_status: string;
  issue_id: string;
  issue_key: string;
  issue_status: string;
  record_date: string;
  product_id: string;
  channel_id: string;
  agent_id: string;
  product_name: string;
  channel_name: string;
  creative_type: string;
  agent_name: string;
  feishu_webhook: string;
  metric: AlertMetric;
  issue_type: AlertType;
  actual_value: number | null;
  baseline_value: number | null;
  deviation_pct: number | null;
  severity_score: number;
  severity: 'critical' | 'high' | 'medium';
  summary_sentence: string;
  action: string;
  unit: 'number' | 'percent';
}

interface DailyReportData {
  reportDate: string;
  highlightItems: HighlightItem[];
  totalIssueCount: number;
}

interface AlertPageState {
  total: number;
  current: number;
  pageSize: number;
}

interface AlertCenterProps {
  scope?: 'admin' | 'agent';
  fixedProductId?: string;
  fixedChannelId?: string;
  fixedAgentId?: string;
}

function pct(value: number | null) {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function valueText(value: number | null, unit: 'number' | 'percent') {
  if (value == null) return '-';
  return unit === 'percent' ? `${Number(value).toFixed(1)}%` : Number(value).toFixed(2);
}

function compareText(left?: string | null, right?: string | null) {
  return String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN');
}

function deviationHit(metric: MetricKey, type: AlertType, value: number | null) {
  if (value == null) return false;
  if (metric === 'cost' || metric === 'activations') {
    return type === '日环比偏离' && (value > 50 || value < -50);
  }
  if (metric === 'cpa') {
    return type === '日环比偏离' ? value >= 25 : value >= 15;
  }
  return type === '日环比偏离' ? value <= -30 : value <= -15;
}

function targetDeviationHit(metric: MetricKey, value: number | null) {
  if (value == null) return false;
  if (metric === 'cost' || metric === 'activations') return false;
  return metric === 'cpa' ? value >= 20 : value <= -20;
}

function baselineFromDeviation(actual: number | null, deviation: number | null) {
  if (actual == null || deviation == null || deviation === -100) return null;
  return actual / (1 + deviation / 100);
}

function escapeMarkdown(value: string) {
  return value.replace(/\n/g, ' ').trim();
}

function severityColor(severity: HighlightItem['severity']) {
  if (severity === 'critical') return 'red';
  if (severity === 'high') return 'volcano';
  return 'orange';
}

function metricColor(metric: AlertMetric) {
  if (metric === '消耗' || metric === '激活') return 'red';
  if (metric === 'CPA') return 'volcano';
  return 'orange';
}

function isProcessedStatus(status?: string | null) {
  return status === 'acknowledged' || status === 'resolved';
}

function buildDataDashboardHref(item: HighlightItem, isAgentScope: boolean, reportDate: string) {
  const dateTo = item.record_date || reportDate;
  const dateFrom = dayjs(dateTo).subtract(7, 'day').format('YYYY-MM-DD');
  const params = new URLSearchParams({
    dateFrom,
    dateTo,
  });
  if (item.creative_type) params.set('creativeTypes', item.creative_type);

  if (isAgentScope) {
    params.set('tab', 'data');
    return `/agent?${params.toString()}`;
  }

  if (item.product_id) params.set('productIds', item.product_id);
  if (item.channel_id) params.set('channelIds', item.channel_id);
  if (item.agent_id) params.set('agentIds', item.agent_id);
  return `/admin/data?${params.toString()}`;
}

function buildAimeMarkdown(report: DailyReportData | null) {
  const generatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const items = report?.highlightItems || [];
  const lines = items.length > 0
    ? items.map((item) => [
      `${item.rank}. ${escapeMarkdown(item.summary_sentence)}`,
      `   - 飞书webhook：${item.feishu_webhook || '未配置（请先在账号与渠道补充）'}`,
      `   - 指标：${item.metric} / ${item.issue_type} / 偏离 ${pct(item.deviation_pct)}`,
      `   - 建议动作：${escapeMarkdown(item.action)}`,
    ].join('\n'))
    : ['今日暂无需要重点提醒的异常。'];

  return [
    '# YokoAgent 今日日报重点',
    '',
    `生成时间：${generatedAt}`,
    `日报日期：${report?.reportDate || dayjs().subtract(1, 'day').format('YYYY-MM-DD')}`,
    `待关注事项数量：${report?.totalIssueCount || 0}`,
    '',
    '## 按严重程度排序',
    '',
    ...lines,
    '',
  ].join('\n');
}

function metricDetailRows(rows: AlertRow[]) {
  return rows.flatMap((row) => (
    (row.metricDetails || []).flatMap((detail) => {
      const candidates: Array<{
        type: AlertType;
        value: number | null;
        baseline: number | null;
        hit: boolean;
      }> = [
        {
          type: '日环比偏离',
          value: detail.dod,
          baseline: baselineFromDeviation(detail.actualValue, detail.dod),
          hit: deviationHit(detail.key, '日环比偏离', detail.dod),
        },
        {
          type: '周同比偏离',
          value: detail.wow,
          baseline: baselineFromDeviation(detail.actualValue, detail.wow),
          hit: deviationHit(detail.key, '周同比偏离', detail.wow),
        },
        {
          type: '考核值偏离',
          value: detail.targetDeviation,
          baseline: detail.targetValue,
          hit: targetDeviationHit(detail.key, detail.targetDeviation),
        },
      ];

      return candidates
        .filter((candidate) => candidate.hit)
        .map((candidate) => ({
          id: `${row.id}:${detail.key}:${candidate.type}`,
          source_alert_id: row.id,
          date: row.record_date,
          product_name: row.product_name,
          channel_name: row.channel_name,
          creative_type: row.creative_type,
          agent_name: row.agent_name,
          feishu_webhook: row.feishu_webhook || '',
          alert_metric: detail.name,
          alert_type: candidate.type,
          actual_value: detail.actualValue,
          baseline_value: candidate.baseline,
          deviation_pct: candidate.value,
          unit: detail.unit,
        } satisfies AlertDetailRow));
    })
  )).sort((left, right) => (
    right.date.localeCompare(left.date) ||
    compareText(left.channel_name, right.channel_name) ||
    compareText(left.agent_name, right.agent_name) ||
    compareText(left.alert_metric, right.alert_metric) ||
    compareText(left.alert_type, right.alert_type)
  ));
}

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
      throw new Error('copy failed');
    }
  }
}

function HighlightList({
  items,
  loading,
  isAgentScope,
  reportDate,
  updatingIssueIds,
  exitingIssueIds,
  onUpdateStatus,
}: {
  items: HighlightItem[];
  loading: boolean;
  isAgentScope: boolean;
  reportDate: string;
  updatingIssueIds: Set<string>;
  exitingIssueIds: Set<string>;
  onUpdateStatus: (item: HighlightItem, nextStatus: AlertStatus) => void;
}) {
  if (!loading && items.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="今日暂无需要重点提醒的异常。"
      />
    );
  }

  return (
    <div className="daily-highlight-column">
      {items.map((item) => (
        <HighlightItemCard
          key={item.issue_id}
          item={item}
          dataHref={buildDataDashboardHref(item, isAgentScope, reportDate)}
          updating={updatingIssueIds.has(item.issue_id)}
          exiting={exitingIssueIds.has(item.issue_id)}
          onUpdateStatus={onUpdateStatus}
        />
      ))}
    </div>
  );
}

function HighlightItemCard({
  item,
  dataHref,
  updating,
  exiting,
  onUpdateStatus,
}: {
  item: HighlightItem;
  dataHref: string;
  updating: boolean;
  exiting: boolean;
  onUpdateStatus: (item: HighlightItem, nextStatus: AlertStatus) => void;
}) {
  const processed = isProcessedStatus(item.issue_status);
  const nextStatus = processed ? 'open' : 'acknowledged';
  return (
    <div className={[
      'daily-highlight-item',
      item.severity === 'critical' ? 'daily-highlight-critical' : '',
      exiting ? 'daily-highlight-item-exiting' : '',
    ].filter(Boolean).join(' ')} data-issue-id={item.issue_id}>
      <div className="daily-highlight-rank">{item.rank}</div>
      <div className="daily-highlight-body">
        <Space wrap size={[6, 6]} className="daily-highlight-tags">
          <Tag color={severityColor(item.severity)}>{item.severity === 'critical' ? '最高优先级' : item.severity === 'high' ? '重点关注' : '关注'}</Tag>
          <Tag color={metricColor(item.metric)}>{item.metric}</Tag>
          <Tag>{item.issue_type}</Tag>
          <Tag color="geekblue">{pct(item.deviation_pct)}</Tag>
        </Space>
        <Paragraph className="daily-highlight-summary">{item.summary_sentence}</Paragraph>
        <Text type="secondary">{item.action}</Text>
        <div className="daily-highlight-webhook">
          <Text type="secondary">飞书webhook：</Text>
          {item.feishu_webhook ? <Text code>{item.feishu_webhook}</Text> : <Tag color="orange">未配置</Tag>}
        </div>
      </div>
      <div className="daily-highlight-actions">
        <Button size="small" icon={<AreaChartOutlined />} href={dataHref}>
          查看数据看板
        </Button>
        <Button
          size="small"
          type={processed ? 'default' : 'primary'}
          icon={<CheckCircleOutlined />}
          disabled={!item.alert_id || !item.issue_key}
          loading={updating}
          aria-label={processed ? '撤销处理' : '标记处理'}
          onClick={() => onUpdateStatus(item, nextStatus)}
        >
          {processed ? '撤销处理' : '标记处理'}
        </Button>
      </div>
    </div>
  );
}

export default function AlertCenter({
  scope = 'admin',
  fixedProductId,
  fixedChannelId,
  fixedAgentId,
}: AlertCenterProps = {}) {
  const isAgentScope = scope === 'agent';
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [dailyReport, setDailyReport] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(!isAgentScope);
  const [status, setStatus] = useState<AlertStatusFilter>('all');
  const [alertPage, setAlertPage] = useState<AlertPageState>({
    total: 0,
    current: 1,
    pageSize: ALERT_DETAIL_PAGE_SIZE,
  });
  const [dailyPage, setDailyPage] = useState(1);
  const [updatingIssueIds, setUpdatingIssueIds] = useState<Set<string>>(new Set());
  const [exitingIssueIds, setExitingIssueIds] = useState<Set<string>>(new Set());
  const [reportDate] = useState(() => dayjs().subtract(1, 'day'));
  const [detailDateRange, setDetailDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs().subtract(1, 'day'),
  ]);
  const [messageApi, contextHolder] = message.useMessage();
  const statusRef = useRef(status);
  const alertPageCurrent = alertPage.current;
  const alertPageSize = alertPage.pageSize;

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom: detailDateRange[0].format('YYYY-MM-DD'),
        dateTo: detailDateRange[1].format('YYYY-MM-DD'),
        status,
        hasAlert: 'true',
        page: String(alertPageCurrent),
        pageSize: String(alertPageSize),
      });
      if (isAgentScope && fixedProductId) params.set('productId', fixedProductId);
      if (isAgentScope && fixedChannelId) params.set('channelId', fixedChannelId);
      if (isAgentScope && fixedAgentId) params.set('agentId', fixedAgentId);
      const response = await fetch(`/api/alerts?${params.toString()}`);
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || '加载失败');
      }
      setRows(payload.data || []);
      setAlertPage((current) => ({
        total: payload.pagination?.total ?? current.total,
        current: payload.pagination?.current ?? current.current,
        pageSize: payload.pagination?.pageSize ?? current.pageSize,
      }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载告警失败');
    } finally {
      setLoading(false);
    }
  }, [alertPageCurrent, alertPageSize, detailDateRange, fixedAgentId, fixedChannelId, fixedProductId, isAgentScope, messageApi, status]);

  const fetchDailyReport = useCallback(async () => {
    if (isAgentScope) {
      setDailyReport(null);
      setDailyLoading(false);
      return;
    }

    setDailyLoading(true);
    try {
      const params = new URLSearchParams({
        dateTo: reportDate.format('YYYY-MM-DD'),
        status,
      });
      if (isAgentScope && fixedProductId) params.set('productId', fixedProductId);
      if (isAgentScope && fixedChannelId) params.set('channelId', fixedChannelId);
      if (isAgentScope && fixedAgentId) params.set('agentId', fixedAgentId);
      const response = await fetch(`/api/daily-report?${params.toString()}`);
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || '日报加载失败');
      }
      setDailyReport(payload.data || null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载日报失败');
    } finally {
      setDailyLoading(false);
    }
  }, [fixedAgentId, fixedChannelId, fixedProductId, isAgentScope, messageApi, reportDate, status]);

  useEffect(() => {
    fetchAlerts();
    fetchDailyReport();
  }, [fetchAlerts, fetchDailyReport]);

  useEffect(() => {
    setDailyPage(1);
  }, [dailyReport?.reportDate, status]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil((dailyReport?.highlightItems.length || 0) / DAILY_NOTE_PAGE_SIZE));
    setDailyPage((current) => Math.min(current, maxPage));
  }, [dailyReport?.highlightItems.length]);

  useEffect(() => {
    statusRef.current = status;
    setUpdatingIssueIds(new Set());
    setExitingIssueIds(new Set());
  }, [status]);

  useEffect(() => {
    setAlertPage((current) => (
      current.current === 1 ? current : { ...current, current: 1 }
    ));
  }, [detailDateRange, status]);

  const aimeMarkdown = useMemo(() => buildAimeMarkdown(dailyReport), [dailyReport]);
  const detailRows = useMemo(() => metricDetailRows(rows), [rows]);

  const copyMarkdown = async () => {
    if (!dailyReport) {
      messageApi.warning('日报尚未加载完成');
      return;
    }
    try {
      await writeClipboardText(aimeMarkdown);
      messageApi.success('已复制今日日报重点');
    } catch {
      messageApi.error('复制失败，请使用下载 Markdown');
    }
  };

  const downloadMarkdown = () => {
    if (!dailyReport) {
      messageApi.warning('日报尚未加载完成');
      return;
    }
    const blob = new Blob([aimeMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yokoagent-daily-report-${dailyReport.reportDate}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const setHighlightIssueStatus = (issueId: string, nextStatus: AlertStatus) => {
    setDailyReport((current) => {
      if (!current) return current;
      return {
        ...current,
        highlightItems: current.highlightItems.map((item) => (
          item.issue_id === issueId ? { ...item, issue_status: nextStatus } : item
        )),
      };
    });
  };

  const removeHighlightIssue = (issueId: string) => {
    setDailyReport((current) => {
      if (!current) return current;
      const nextItems = current.highlightItems.filter((item) => item.issue_id !== issueId);
      return {
        ...current,
        highlightItems: nextItems,
        totalIssueCount: nextItems.length,
      };
    });
  };

  const updateIssueStatus = async (item: HighlightItem, nextStatus: AlertStatus) => {
    if (!item.alert_id || !item.issue_key) return;
    const previousStatus = item.issue_status as AlertStatus;
    const issueId = item.issue_id;
    const stayInCurrentList = status === 'all';
    const statusAtClick = status;

    setUpdatingIssueIds((current) => new Set(current).add(issueId));
    if (stayInCurrentList) {
      setHighlightIssueStatus(issueId, nextStatus);
    }

    try {
      const response = await fetch('/api/alert-issues/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertId: item.alert_id,
          issueKey: item.issue_key,
          status: nextStatus,
        }),
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || '更新处理状态失败');
      }
      messageApi.success(nextStatus === 'open' ? '已撤销处理' : '已标记处理');
      if (!stayInCurrentList) {
        setHighlightIssueStatus(issueId, nextStatus);
        setExitingIssueIds((current) => new Set(current).add(issueId));
        window.setTimeout(() => {
          if (statusRef.current === statusAtClick) {
            removeHighlightIssue(issueId);
          }
          setExitingIssueIds((current) => {
            const next = new Set(current);
            next.delete(issueId);
            return next;
          });
        }, DAILY_HIGHLIGHT_EXIT_MS);
      }
    } catch (error) {
      if (stayInCurrentList) {
        setHighlightIssueStatus(issueId, previousStatus);
      }
      messageApi.error(error instanceof Error ? error.message : '更新处理状态失败');
    } finally {
      setUpdatingIssueIds((current) => {
        const next = new Set(current);
        next.delete(issueId);
        return next;
      });
    }
  };

  const highlightItems = dailyReport?.highlightItems || [];
  const pagedHighlightItems = highlightItems.slice((dailyPage - 1) * DAILY_NOTE_PAGE_SIZE, dailyPage * DAILY_NOTE_PAGE_SIZE);
  const columns: TableColumnsType<AlertDetailRow> = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 126,
      sorter: (left, right) => left.date.localeCompare(right.date),
      defaultSortOrder: 'descend',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '产品',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 130,
      sorter: (left, right) => compareText(left.product_name, right.product_name),
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '渠道',
      dataIndex: 'channel_name',
      key: 'channel_name',
      width: 120,
      sorter: (left, right) => compareText(left.channel_name, right.channel_name),
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '体裁',
      dataIndex: 'creative_type',
      key: 'creative_type',
      width: 120,
      sorter: (left, right) => compareText(left.creative_type, right.creative_type),
      render: (value: string) => <Tag color="purple">{value || '-'}</Tag>,
    },
    {
      title: '代理商',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 170,
      sorter: (left, right) => compareText(left.agent_name, right.agent_name),
      render: (value: string) => <Text strong>{value}</Text>,
    },
    ...(isAgentScope ? [] : [{
      title: '飞书webhook',
      dataIndex: 'feishu_webhook',
      key: 'feishu_webhook',
      width: 260,
      ellipsis: true,
      sorter: (left, right) => compareText(left.feishu_webhook, right.feishu_webhook),
      render: (value: string) => value ? <Text code>{value}</Text> : <Tag color="orange">未配置</Tag>,
    } satisfies TableColumnsType<AlertDetailRow>[number]]),
    {
      title: '告警指标',
      dataIndex: 'alert_metric',
      key: 'alert_metric',
      width: 112,
      sorter: (left, right) => compareText(left.alert_metric, right.alert_metric),
      render: (value: AlertMetric) => <Tag color={metricColor(value)}>{value}</Tag>,
    },
    {
      title: '告警类型',
      dataIndex: 'alert_type',
      key: 'alert_type',
      width: 132,
      sorter: (left, right) => compareText(left.alert_type, right.alert_type),
    },
    {
      title: 'T-1填列值',
      dataIndex: 'actual_value',
      key: 'actual_value',
      width: 128,
      align: 'right',
      sorter: (left, right) => Number(left.actual_value ?? Number.NEGATIVE_INFINITY) - Number(right.actual_value ?? Number.NEGATIVE_INFINITY),
      render: (_: number | null, row) => <Text strong>{valueText(row.actual_value, row.unit)}</Text>,
    },
    {
      title: '基准值',
      dataIndex: 'baseline_value',
      key: 'baseline_value',
      width: 128,
      align: 'right',
      sorter: (left, right) => Number(left.baseline_value ?? Number.NEGATIVE_INFINITY) - Number(right.baseline_value ?? Number.NEGATIVE_INFINITY),
      render: (_: number | null, row) => valueText(row.baseline_value, row.unit),
    },
    {
      title: '偏离百分比',
      dataIndex: 'deviation_pct',
      key: 'deviation_pct',
      width: 130,
      align: 'right',
      sorter: (left, right) => Number(left.deviation_pct ?? Number.NEGATIVE_INFINITY) - Number(right.deviation_pct ?? Number.NEGATIVE_INFINITY),
      render: (value: number | null) => <Text type="danger" strong>{pct(value)}</Text>,
    },
  ];
  const resizableColumns = useResizableColumns(
    isAgentScope ? 'agent-alert-columns' : 'admin-alert-columns',
    columns
  );

  return (
    <>
      {contextHolder}
      <div className="console-stack">
        <Card className="section-card">
          <div className="hero-row">
            <Space wrap>
              <Text strong>处理状态</Text>
              <Select
                value={status}
                style={{ width: 140 }}
                onChange={setStatus}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'processed', label: '已处理' },
                  { value: 'open', label: '未处理' },
                ]}
              />
            </Space>
            <Space wrap>
              {!isAgentScope && (
                <>
                  <Button icon={<CopyOutlined />} disabled={!dailyReport} onClick={copyMarkdown}>复制给 Aime</Button>
                  <Button icon={<DownloadOutlined />} disabled={!dailyReport} onClick={downloadMarkdown}>下载 MD</Button>
                </>
              )}
              <Button icon={<ReloadOutlined />} onClick={() => { fetchAlerts(); fetchDailyReport(); }}>刷新</Button>
            </Space>
          </div>
        </Card>

        {!isAgentScope && (
          <Card
            className="section-card daily-highlight-card"
            loading={dailyLoading}
            title={(
              <Space wrap>
                <Tag color="red">今日日报重点</Tag>
                <span>{dailyReport?.reportDate || reportDate.format('YYYY-MM-DD')}数据</span>
              </Space>
            )}
            extra={<Text type="secondary">按严重程度排序，消耗/量级巨幅波动优先</Text>}
          >
            <div className="daily-highlight-header">
              <div>
                <Title level={4} style={{ marginBottom: 4 }}>今天最需要关注的 {dailyReport?.totalIssueCount || 0} 件事</Title>
                <Paragraph className="hero-text">每页固定展示 5 件事，按严重程度从高到低排列。</Paragraph>
              </div>
              <Space wrap>
                <Tag color="red">最高优先级：消耗/量级巨幅波动</Tag>
                <Tag color="volcano">其次：CPA</Tag>
                <Tag color="orange">再次：次留 / 7留</Tag>
              </Space>
            </div>
            <div className="daily-note-paper">
              <HighlightList
                items={pagedHighlightItems}
                loading={dailyLoading}
                isAgentScope={isAgentScope}
                reportDate={dailyReport?.reportDate || reportDate.format('YYYY-MM-DD')}
                updatingIssueIds={updatingIssueIds}
                exitingIssueIds={exitingIssueIds}
                onUpdateStatus={updateIssueStatus}
              />
              {highlightItems.length > DAILY_NOTE_PAGE_SIZE ? (
                <div className="daily-note-pagination">
                  <Pagination
                    current={dailyPage}
                    total={highlightItems.length}
                    pageSize={DAILY_NOTE_PAGE_SIZE}
                    showSizeChanger={false}
                    onChange={setDailyPage}
                  />
                </div>
              ) : null}
            </div>
          </Card>
        )}

        <Card
          className="section-card"
          title="告警明细"
          extra={(
            <Space wrap>
              <Text strong>日期筛选</Text>
              <RangePicker
                value={detailDateRange}
                allowClear={false}
                onChange={(value) => value && setDetailDateRange([value[0]!, value[1]!])}
              />
              <Text type="secondary">当前页 {detailRows.length} 条明细 / 共 {alertPage.total} 条告警记录</Text>
            </Space>
          )}
        >
          <div className="table-scroll-shell">
            <Table
              rowKey="id"
              loading={loading}
              dataSource={detailRows}
              columns={resizableColumns}
              pagination={{
                current: alertPage.current,
                pageSize: alertPage.pageSize,
                total: alertPage.total,
                showSizeChanger: true,
                pageSizeOptions: [50, 100, 200, 500],
                showTotal: (total) => `共 ${total} 条告警记录`,
                onChange: (current, pageSize) => setAlertPage((previous) => ({
                  total: previous.total,
                  current,
                  pageSize,
                })),
              }}
              locale={{ emptyText: '当前筛选条件下暂无告警明细；初始化演示数据后可看到由真实填报计算出的异常。' }}
              scroll={{ x: isAgentScope ? 1360 : 1620 }}
              tableLayout="fixed"
            />
          </div>
        </Card>
      </div>
    </>
  );
}
