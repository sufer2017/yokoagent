import type { Metadata } from "next";
import AntdProvider from "@/components/providers/AntdProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "YokoAgent - 广告投放代理管理平台",
  description: "数据驱动的广告投放代理管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
