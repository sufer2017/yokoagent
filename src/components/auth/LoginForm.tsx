'use client';

import React, { useState } from 'react';
import { Card, Form, Input, Button, Segmented, Typography, message, Space } from 'antd';
import { UserOutlined, LockOutlined, TeamOutlined, CrownOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@/types/auth';

const { Title, Text } = Typography;

export default function LoginForm() {
  const [role, setRole] = useState<UserRole>('agent');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();

  const handleLogin = async (values: Record<string, string>) => {
    setLoading(true);
    try {
      const body = role === 'agent'
        ? { role, name: values.name }
        : { role, username: values.username, password: values.password };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        messageApi.success(data.message);
        // Redirect based on role
        setTimeout(() => {
          router.push(role === 'agent' ? '/agent' : '/admin/overview');
        }, 500);
      } else {
        messageApi.error(data.message);
      }
    } catch {
      messageApi.error('网络错误，请检查连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {contextHolder}
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 24,
      }}>
        <Card
          style={{ width: 400, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}
          styles={{ body: { padding: '32px 32px 24px' } }}
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <Title level={3} style={{ margin: 0 }}>YokoAgent</Title>
              <Text type="secondary">广告投放代理管理平台</Text>
            </div>

            <Segmented
              block
              value={role}
              onChange={(val) => {
                setRole(val as UserRole);
                form.resetFields();
              }}
              options={[
                { label: <span><TeamOutlined /> 代理</span>, value: 'agent' },
                { label: <span><CrownOutlined /> 管理员</span>, value: 'admin' },
              ]}
              style={{ marginBottom: 8 }}
            />

            <Form
              form={form}
              onFinish={handleLogin}
              layout="vertical"
              size="large"
              autoComplete="off"
            >
              {role === 'agent' ? (
                <Form.Item
                  name="name"
                  rules={[{ required: true, message: '请输入您的姓名' }]}
                >
                  <Input
                    prefix={<UserOutlined />}
                    placeholder="请输入姓名"
                    autoFocus
                  />
                </Form.Item>
              ) : (
                <>
                  <Form.Item
                    name="username"
                    rules={[{ required: true, message: '请输入账号' }]}
                  >
                    <Input
                      prefix={<UserOutlined />}
                      placeholder="账号"
                      autoFocus
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    rules={[{ required: true, message: '请输入密码' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="密码"
                    />
                  </Form.Item>
                </>
              )}

              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={{ height: 44 }}
                >
                  {loading ? '登录中...' : '登录'}
                </Button>
              </Form.Item>
            </Form>
          </Space>
        </Card>
      </div>
    </>
  );
}
