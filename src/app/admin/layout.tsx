'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Typography, Button, Space, Spin, Tabs } from 'antd';
import {
  DashboardOutlined,
  AlertOutlined,
  ApartmentOutlined,
  SlidersOutlined,
  LogoutOutlined,
  CrownOutlined,
  AreaChartOutlined,
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';
import type { Session } from '@/types/auth';

const { Header, Content } = Layout;
const { Text } = Typography;

const TAB_ITEMS = [
  { key: '/admin/data', icon: <AreaChartOutlined />, label: '数据看板' },
  { key: '/admin/overview', icon: <DashboardOutlined />, label: '填报看板' },
  { key: '/admin/alerts', icon: <AlertOutlined />, label: '站内告警' },
  { key: '/admin/targets', icon: <SlidersOutlined />, label: '考核指标' },
  { key: '/admin/management', icon: <ApartmentOutlined />, label: '账号与渠道' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data.role === 'admin') {
          setSession(data.data);
        } else {
          router.push('/login');
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', maxWidth: '100%', overflowX: 'hidden' }}>
      <Layout style={{ minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
        <Header style={{
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <Space>
            <CrownOutlined style={{ color: '#faad14' }} />
            <Text strong>YokoAgent 管理后台</Text>
          </Space>
          <Space>
            <Text type="secondary">{session?.role === 'admin' ? '管理员' : ''}</Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: '#f5f5f5', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
          <Tabs
            activeKey={pathname}
            items={TAB_ITEMS.map((item) => ({
              key: item.key,
              label: (
                <span>
                  {item.icon}
                  <span style={{ marginLeft: 8 }}>{item.label}</span>
                </span>
              ),
            }))}
            onChange={(key) => router.push(key)}
            style={{ marginBottom: 16 }}
          />
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
