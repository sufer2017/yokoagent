'use client';

import React, { useState } from 'react';
import { Card, Form, Input, Button, Segmented, Typography, message, Tag } from 'antd';
import { UserOutlined, LockOutlined, TeamOutlined, CrownOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@/types/auth';
import { mockAgents } from '@/lib/mock/seed';

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
          router.push(role === 'agent' ? '/agent' : '/admin/strategy');
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
              一套围绕周策略制定、周中监控、预算重分配和日报输出来设计的投放策略控制台。
            </Text>

            <div className="console-stack" style={{ marginTop: 28 }}>
              <Card variant="borderless" style={{ background: 'rgba(255,255,255,0.74)' }}>
                <Title level={4}>你会在这里完成什么</Title>
                <ul style={{ paddingLeft: 18, color: 'var(--text-muted)', lineHeight: 1.9 }}>
                  <li>周一录入预算上限与四项核心约束</li>
                  <li>设置各渠道预算占比区间并一键生成分配方案</li>
                  <li>查看渠道-代理的赛马结果、趋势与预警</li>
                  <li>一键生成固定格式日报并复制发送</li>
                </ul>
              </Card>
              <Card variant="borderless" style={{ background: 'rgba(255,255,255,0.74)' }}>
                <Title level={5}><SafetyCertificateOutlined /> Demo 登录提示</Title>
                <div className="badge-row">
                  {mockAgents.slice(0, 8).map((agent) => (
                    <Tag key={agent.id}>{agent.name}</Tag>
                  ))}
                </div>
                <Text type="secondary">管理员账号固定为 `admin` / `yzy19990704@`。</Text>
              </Card>
            </div>
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
                  <Form.Item
                    name="name"
                    label="姓名"
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
                    {loading ? '登录中...' : role === 'agent' ? '进入代理填报页' : '进入管理员策略台'}
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
