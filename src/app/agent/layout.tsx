'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Typography, Button, Space, Spin } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { Session } from '@/types/auth';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
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
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: 'rgba(255,255,255,0.92)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #e7ebf3',
        boxShadow: '0 12px 40px rgba(16,36,71,0.06)',
      }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>YokoAgent</Title>
          <Text type="secondary">|</Text>
          <Text type="secondary">数据填报</Text>
        </Space>
        <Space>
          <UserOutlined />
          <Text strong>{session?.agentName}</Text>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
          >
            退出
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24, background: 'transparent' }}>
        {children}
      </Content>
    </Layout>
  );
}
