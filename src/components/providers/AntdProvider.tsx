'use client';

import React from 'react';
import { ConfigProvider, App } from 'antd';
import zhCN from 'antd/locale/zh_CN';

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1f6bff',
          colorInfo: '#1f6bff',
          colorSuccess: '#138a5d',
          colorWarning: '#d97706',
          colorError: '#cc4b37',
          borderRadius: 18,
          fontSize: 14,
          fontFamily: 'var(--font-sans)',
          colorBgLayout: '#f6f8fc',
          boxShadowSecondary: '0 20px 60px rgba(15, 23, 42, 0.08)',
        },
        components: {
          Card: {
            borderRadiusLG: 24,
          },
          Button: {
            borderRadius: 14,
            controlHeight: 42,
          },
          Input: {
            borderRadius: 14,
          },
          InputNumber: {
            borderRadius: 14,
          },
          Select: {
            borderRadius: 14,
          },
          Table: {
            headerBg: '#f2f5ff',
            borderColor: '#e7ebf3',
          },
          Tabs: {
            itemSelectedColor: '#102447',
            itemColor: '#65748b',
            inkBarColor: '#1f6bff',
          },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
