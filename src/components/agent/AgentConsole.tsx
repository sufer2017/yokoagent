'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Spin, Tabs } from 'antd';
import {
  AlertOutlined,
  AreaChartOutlined,
  ClockCircleOutlined,
  FormOutlined,
} from '@ant-design/icons';
import type { Session } from '@/types/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import DailyRecordTable from '@/components/agent/DailyRecordTable';
import DataDashboard from '@/components/admin/DataDashboard';
import OverviewDashboard from '@/components/admin/OverviewDashboard';
import AlertCenter from '@/components/admin/AlertCenter';

export default function AgentConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam && ['records', 'data', 'fill', 'alerts'].includes(tabParam) ? tabParam : 'records';

  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((payload) => {
        if (payload.success && payload.data?.role === 'agent') {
          setSession(payload.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!session?.agentId || !session.productId || !session.channelId) {
    return <Alert type="error" showIcon message="当前账号未绑定产品、渠道或代理商，请联系管理员检查账号配置。" />;
  }

  const scopeProps = {
    scope: 'agent' as const,
    fixedProductId: session.productId,
    fixedChannelId: session.channelId,
    fixedAgentId: session.agentId,
    fixedProductName: session.productName,
    fixedChannelName: session.channelName,
    fixedAgentName: session.agentName,
  };

  const handleTabChange = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'records') {
      params.delete('tab');
    } else {
      params.set('tab', key);
    }
    const query = params.toString();
    router.push(query ? `/agent?${query}` : '/agent');
  };

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={[
        {
          key: 'records',
          label: (
            <span><FormOutlined /> T-1数据填报</span>
          ),
          children: <DailyRecordTable />,
        },
        {
          key: 'data',
          label: (
            <span><AreaChartOutlined /> 数据看板</span>
          ),
          children: <DataDashboard {...scopeProps} />,
        },
        {
          key: 'fill',
          label: (
            <span><ClockCircleOutlined /> 填报逾期情况</span>
          ),
          children: <OverviewDashboard {...scopeProps} />,
        },
        {
          key: 'alerts',
          label: (
            <span><AlertOutlined /> 告警信息</span>
          ),
          children: <AlertCenter {...scopeProps} />,
        },
      ]}
    />
  );
}
