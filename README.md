# YokoAgent

YokoAgent 是一个部署在 Vercel 上的广告投放代理管理平台，包含两种角色：

- 代理：仅输入姓名登录，只能查看和编辑自己的投放数据
- 管理员：使用固定账号密码登录，管理代理池、预算分配、约束规则和全局数据总览

## 技术栈

- Next.js 16 App Router
- React 19
- Ant Design 6
- Supabase 作为数据库
- JWT Cookie 作为轻量认证

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

复制 `.env.example` 到 `.env.local`，并填入：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`

管理员默认登录凭证：

- 用户名：`admin`
- 密码：`yzy19990704@`

如需覆盖，可额外设置：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

3. 初始化数据库

将 [supabase/schema.sql](/Users/huanghaolong/yokoagent/supabase/schema.sql) 中的 SQL 执行到 Supabase 项目中。

4. 启动开发服务器

```bash
npm run dev
```

## 功能说明

- 登录页支持“代理 / 管理员”角色切换
- 代理端支持按日期、渠道、项目逐行填报并修改历史数据
- 管理员端支持代理池管理、渠道和项目管理
- 管理员端支持渠道预算和代理级分配管理
- 管理员端支持硬约束和自定义约束配置
- 数据总览支持按代理、渠道、项目、日期范围筛选，并对超约束数据标红预警

## 部署

仓库推送到 GitHub `main` 分支后，可由 Vercel 自动构建部署。部署前请在 Vercel 项目里配置与本地一致的 Supabase 和 JWT 环境变量。
