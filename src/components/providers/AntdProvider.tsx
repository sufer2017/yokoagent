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
          colorPrimary: '#1677ff',
          borderRadius: 6,
          fontSize: 14,
        },
        components: {
          Layout: {
            siderBg: '#001529',
            headerBg: '#fff',
          },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
