'use client';

import React, { useState } from 'react';
import { Card, Form, Input, Button, Segmented, Typography, message, Tag } from 'antd';
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
        ? { role, username: values.username, password: values.password }
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
          router.push(role === 'agent' ? '/agent' : '/admin/data');
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
      <div className="login-shell">
        <div className="login-frame">
          <div className="login-panel login-hero">
            <Tag color="blue">YokoAgent V2</Tag>
            <Title level={1} style={{ marginTop: 18, marginBottom: 12 }}>
              广告投放代理管理平台
            </Title>
            <Text type="secondary">
              面向外部代理的 T-1 数据填报、权限隔离、考核匹配、站内告警和管理员填报看板。
            </Text>

            <Card variant="borderless" style={{ background: 'rgba(255,255,255,0.74)', marginTop: 28 }}>
              <Title level={4}>你会在这里完成什么</Title>
              <ul style={{ paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.9 }}>
                <li>管理员维护公司级代理账号和考核指标</li>
                <li>代理公司按 T-1 日期填报投放数据</li>
                <li>系统按体裁自动计算日环比、周同比和考核偏离</li>
                <li>管理员查看数据看板、填报过程、未填代理和站内告警</li>
              </ul>
            </Card>
          </div>

          <Card className="login-panel login-form-card" styles={{ body: { padding: 0 } }}>
            <div className="console-stack">
              <div>
                <Title level={3} style={{ marginBottom: 4 }}>进入控制台</Title>
                <Text type="secondary">先选择你的身份，再进入对应工作界面。</Text>
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
              />

              <Form
                form={form}
                onFinish={handleLogin}
                layout="vertical"
                size="large"
                autoComplete="off"
              >
                {role === 'agent' ? (
                  <>
                    <Form.Item
                      name="username"
                      label="代理账号"
                      rules={[{ required: true, message: '请输入代理账号' }]}
                    >
                      <Input
                        prefix={<UserOutlined />}
                        placeholder="例如 gdt-a"
                        autoFocus
                      />
                    </Form.Item>
                    <Form.Item
                      name="password"
                      label="密码"
                      rules={[{ required: true, message: '请输入密码' }]}
                    >
                      <Input.Password
                        prefix={<LockOutlined />}
                        placeholder="请输入密码"
                      />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item
                      name="username"
                      label="账号"
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
                      label="密码"
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
                    style={{ height: 48 }}
                  >
                    {loading ? '登录中...' : role === 'agent' ? '进入代理填报页' : '进入管理员看板'}
                  </Button>
                </Form.Item>
              </Form>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
