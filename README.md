# AriyaeiNetwork 🪐

**An all-in-one VPN/Proxy node deployment and subscriber management panel.**

Created and maintained by **Armin Hamizadeh (آرمین حامی‌زاده)**.

AriyaeiNetwork unifies ideas from several well-known panels — Marzban-style subscriber
management, X-UI-style protocol configuration, and Hiddify-style ease of deployment —
into a single Node.js/TypeScript backend with a Next.js dashboard.

> 🌐 Languages: [English](README.md) · [中文](README.zh.md) · [فارسی](README.fa.md)

---

## ✨ Features

- **Flexible expiration lifecycle** per user:
  - `first_connect` — the countdown starts the moment the user's first packet is seen.
  - `fixed_date` — a hard calendar expiry.
  - `volume_only` — expires strictly on a data cap.
  - `temporary_test` — 24h self-expiring trial accounts.
- **One-click node deployment** over SSH: Gost, Rathole, Backhaul, Hysteria2, and 6to4
  relay tunnels, plus kernel BBR tuning and Cloudflare Warp outbound routing.
- **IP quality pool**: a Redis-backed pool of egress IPs scored against public
  blacklists (Spamhaus, Barracuda, SpamCop) and basic latency, so subscribers can be
  routed through healthier exit IPs.
- **Multilingual Telegram bot** (Persian / English / Chinese): trial issuance, status
  checks, renewal requests, and admin broadcast.
- **Admin dashboard** built with Next.js, Tailwind CSS, and Shadcn UI.

## 🏗️ Architecture

```
                    ┌───────────────────────┐
                    │     Next.js Panel      │
                    │  (React / Tailwind /   │
                    │      Shadcn UI)        │
                    └───────────┬───────────┘
                                │ REST (JWT)
                    ┌───────────▼───────────┐
                    │   Fastify API Server   │
                    │  (Node.js / TypeScript)│
                    └──┬───────┬──────────┬──┘
                       │       │          │
            ┌──────────▼─┐ ┌───▼───┐ ┌────▼─────┐
            │ PostgreSQL │ │ Redis │ │ Telegram  │
            │  (Prisma)  │ │ pools │ │   Bot     │
            └────────────┘ └───┬───┘ └───────────┘
                                │
                     ┌──────────▼──────────┐
                     │  SSH Deployment Bus  │
                     │ (node-ssh, systemd)  │
                     └──────────┬───────────┘
                                │
                  ┌─────────────┼─────────────┐
             ┌────▼───┐   ┌─────▼────┐  ┌──────▼─────┐
             │  Gost  │   │ Rathole  │  │ Hysteria2  │
             │ Nodes  │   │ / Backhaul│  │ / 6to4     │
             └────────┘   └──────────┘  └────────────┘
```

## 🚀 Getting Started

### Requirements

- Docker & Docker Compose
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- SSH access (key-based) to the servers you intend to manage as nodes

### Setup

```bash
git clone https://github.com/<your-org>/AriyaeiNetwork.git
cd AriyaeiNetwork
cp .env.example .env
# edit .env with your DB password, Telegram token, and JWT secret

mkdir -p secrets/ssh-keys
# place your node SSH private keys here, referenced by Node.sshKeyRef in the DB

docker compose up -d --build
```

The API will be available at `http://localhost:4000` and the dashboard at
`http://localhost:3000`.

### Database migrations

```bash
docker compose exec backend npx prisma migrate deploy
```

## 📁 Repository Layout

```
AriyaeiNetwork/
├── backend/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts                 # Fastify server + cron scheduler
│       ├── bot/telegram-bot.ts      # fa/en/zh Telegram bot
│       └── services/
│           ├── expiration-engine.ts
│           ├── node-deployment.ts
│           └── ip-harvester.ts
├── frontend/                        # Next.js dashboard (see /frontend/README.md)
├── docker-compose.yml
├── Dockerfile
└── docs/ (README.fa.md, README.zh.md, README.CREATOR.fa.md)
```

## ⚖️ Responsible Use

AriyaeiNetwork is infrastructure-management software for operators running their own
VPN/proxy fleets. It does not include, and will not include, features specifically
built to defeat the anti-abuse or anti-fraud systems of individual third-party
services. Operators are responsible for complying with the laws of their jurisdiction
and the terms of service of any networks or services their users connect through.

## 📜 License

MIT © Armin Hamizadeh (آرمین حامی‌زاده)
