# AriyaeiNetwork 🪐

**一体化 VPN/代理节点部署与订阅用户管理面板。**

由 **Armin Hamizadeh（آرمین حامی‌زاده）** 创建并维护。

AriyaeiNetwork 融合了多种知名面板的理念——类似 Marzban 的订阅管理、类似 X-UI 的协议
配置能力，以及类似 Hiddify 的易部署体验——统一在一个基于 Node.js/TypeScript 的后端
与 Next.js 前端面板中。

> 🌐 语言版本：[English](README.md) · [中文](README.zh.md) · [فارسی](README.fa.md)

---

## ✨ 功能特性

- **灵活的用户到期机制**：
  - `first_connect`（首次连接计时）—— 计时器仅在检测到用户首个流量字节时启动。
  - `fixed_date`（固定日期）—— 硬性日历到期时间。
  - `volume_only`（仅按流量）—— 达到流量上限即到期。
  - `temporary_test`（临时试用）—— 24小时自动到期的试用账户。
- **一键节点部署**：通过 SSH 自动化部署 Gost、Rathole、Backhaul、Hysteria2 及 6to4
  中继隧道，并支持内核 BBR 调优与 Cloudflare Warp 出站路由部署。
- **IP 质量池**：基于 Redis 的出口 IP 池，依据公共黑名单（Spamhaus、Barracuda、
  SpamCop）及基础延迟指标进行评分，便于将用户路由到更健康的出口 IP。
- **多语言 Telegram 机器人**（波斯语 / 英语 / 中文）：试用发放、状态查询、续费申请
  以及管理员群发通知。
- **管理后台**：基于 Next.js、Tailwind CSS 与 Shadcn UI 构建。

## 🏗️ 系统架构

```
                    ┌───────────────────────┐
                    │     Next.js 管理面板    │
                    │  (React / Tailwind /   │
                    │      Shadcn UI)        │
                    └───────────┬───────────┘
                                │ REST (JWT)
                    ┌───────────▼───────────┐
                    │   Fastify API 服务      │
                    │  (Node.js / TypeScript)│
                    └──┬───────┬──────────┬──┘
                       │       │          │
            ┌──────────▼─┐ ┌───▼───┐ ┌────▼─────┐
            │ PostgreSQL │ │ Redis │ │ Telegram  │
            │  (Prisma)  │ │  池   │ │  机器人   │
            └────────────┘ └───┬───┘ └───────────┘
                                │
                     ┌──────────▼──────────┐
                     │   SSH 部署总线        │
                     │ (node-ssh, systemd)  │
                     └──────────┬───────────┘
                                │
                  ┌─────────────┼─────────────┐
             ┌────▼───┐   ┌─────▼────┐  ┌──────▼─────┐
             │  Gost  │   │ Rathole  │  │ Hysteria2  │
             │  节点   │   │/Backhaul │  │  / 6to4    │
             └────────┘   └──────────┘  └────────────┘
```

## 🚀 快速开始

### 环境要求

- Docker 与 Docker Compose
- Telegram 机器人 Token（通过 [@BotFather](https://t.me/BotFather) 获取）
- 目标节点服务器的 SSH 密钥访问权限

### 部署步骤

```bash
git clone https://github.com/<your-org>/AriyaeiNetwork.git
cd AriyaeiNetwork
cp .env.example .env
# 编辑 .env，填入数据库密码、Telegram Token 与 JWT 密钥

mkdir -p secrets/ssh-keys
# 将节点的 SSH 私钥放入此目录，并在数据库 Node.sshKeyRef 字段中引用

docker compose up -d --build
```

API 服务地址：`http://localhost:4000`，管理面板地址：`http://localhost:3000`。

### 数据库迁移

```bash
docker compose exec backend npx prisma migrate deploy
```

## 📁 仓库结构

```
AriyaeiNetwork/
├── backend/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts                 # Fastify 服务 + 定时任务
│       ├── bot/telegram-bot.ts      # fa/en/zh Telegram 机器人
│       └── services/
│           ├── expiration-engine.ts
│           ├── node-deployment.ts
│           └── ip-harvester.ts
├── frontend/                        # Next.js 管理面板
├── docker-compose.yml
├── Dockerfile
└── docs/（README.fa.md、README.zh.md、README.CREATOR.fa.md）
```

## ⚖️ 合理使用声明

AriyaeiNetwork 是面向自有 VPN/代理节点运营者的基础设施管理软件。项目不包含、也不会
包含专门用于绕过第三方服务反滥用或反欺诈系统的功能。运营者需自行遵守所在司法辖区的
法律法规，以及用户所连接的任何网络或服务的使用条款。

## 📜 许可证

MIT © Armin Hamizadeh（آرمین حامی‌زاده）
