import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from 'next/font/google';
import AntdProvider from '@/components/providers/AntdProvider';
import { MockAppProvider } from '@/lib/mock/store';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'YokoAgent - 广告投放代理管理平台',
  description: '数据驱动的广告投放代理管理系统',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AntdProvider>
          <MockAppProvider>{children}</MockAppProvider>
        </AntdProvider>
      </body>
    </html>
  );
}
