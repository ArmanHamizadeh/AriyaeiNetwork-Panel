# AriyaeiNetwork 🪐

**پنل همه‌کاره‌ی مدیریت نصب نود VPN/پروکسی و مدیریت مشترکین.**

ساخته و نگهداری‌شده توسط **آرمین حامی‌زاده (Armin Hamizadeh)**.

AriyaeiNetwork ایده‌های چند پنل شناخته‌شده را ترکیب کرده: مدیریت مشترکین شبیه به
Marzban، پیکربندی پروتکل‌ها شبیه به X-UI، و سادگی نصب شبیه به Hiddify — همه در یک
بک‌اند Node.js/TypeScript به همراه یک داشبورد Next.js.

> 🌐 زبان‌ها: [English](README.md) · [中文](README.zh.md) · [فارسی](README.fa.md)

---

## ✨ امکانات

- **چرخه‌ی انقضای منعطف** برای هر کاربر:
  - `first_connect` — تایمر انقضا فقط با اولین بایت ترافیک کاربر شروع می‌شود.
  - `fixed_date` — تاریخ انقضای ثابت تقویمی.
  - `volume_only` — انقضا صرفاً بر اساس سقف مصرف حجم.
  - `temporary_test` — اکانت تست ۲۴ ساعته با انقضای خودکار.
- **نصب یک‌کلیکی نود** از طریق SSH: تانل‌های Gost، Rathole، Backhaul، Hysteria2 و
  ریله‌ی 6to4، به‌همراه بهینه‌سازی کرنل با BBR و راه‌اندازی مسیر خروجی Cloudflare Warp.
- **استخر کیفیت IP**: مجموعه‌ای از IPهای خروجی روی Redis که بر اساس بلک‌لیست‌های
  عمومی (Spamhaus، Barracuda، SpamCop) و تأخیر پایه امتیازدهی می‌شوند، تا کاربران به
  IPهای سالم‌تر مسیردهی شوند.
- **ربات تلگرام چندزبانه** (فارسی / انگلیسی / چینی): صدور تست، بررسی وضعیت، درخواست
  تمدید و ارسال پیام همگانی توسط مدیران.
- **داشبورد مدیریتی** با Next.js، Tailwind CSS و Shadcn UI.

## 🏗️ معماری

```
                    ┌───────────────────────┐
                    │      پنل Next.js        │
                    │  (React / Tailwind /   │
                    │      Shadcn UI)        │
                    └───────────┬───────────┘
                                │ REST (JWT)
                    ┌───────────▼───────────┐
                    │   سرور API با Fastify   │
                    │  (Node.js / TypeScript)│
                    └──┬───────┬──────────┬──┘
                       │       │          │
            ┌──────────▼─┐ ┌───▼───┐ ┌────▼─────┐
            │ PostgreSQL │ │ Redis │ │ Telegram  │
            │  (Prisma)  │ │استخرها│ │   ربات    │
            └────────────┘ └───┬───┘ └───────────┘
                                │
                     ┌──────────▼──────────┐
                     │   گذرگاه استقرار SSH   │
                     │ (node-ssh, systemd)  │
                     └──────────┬───────────┘
                                │
                  ┌─────────────┼─────────────┐
             ┌────▼───┐   ┌─────▼────┐  ┌──────▼─────┐
             │  Gost  │   │ Rathole  │  │ Hysteria2  │
             │  نودها  │   │/Backhaul │  │  / 6to4    │
             └────────┘   └──────────┘  └────────────┘
```

## 🚀 راه‌اندازی

### پیش‌نیازها

- Docker و Docker Compose
- توکن ربات تلگرام (از [@BotFather](https://t.me/BotFather))
- دسترسی SSH (مبتنی بر کلید) به سرورهایی که قرار است به‌عنوان نود مدیریت شوند

### مراحل نصب

```bash
git clone https://github.com/<your-org>/AriyaeiNetwork.git
cd AriyaeiNetwork
cp .env.example .env
# فایل .env را با رمز دیتابیس، توکن تلگرام و JWT secret ویرایش کنید

mkdir -p secrets/ssh-keys
# کلیدهای خصوصی SSH نودها را اینجا قرار دهید و در فیلد Node.sshKeyRef دیتابیس ارجاع دهید

docker compose up -d --build
```

آدرس API: `http://localhost:4000` و آدرس داشبورد: `http://localhost:3000`.

### مایگریشن دیتابیس

```bash
docker compose exec backend npx prisma migrate deploy
```

## 📁 ساختار مخزن

```
AriyaeiNetwork/
├── backend/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts                 # سرور Fastify + زمان‌بند کرون
│       ├── bot/telegram-bot.ts      # ربات تلگرام fa/en/zh
│       └── services/
│           ├── expiration-engine.ts
│           ├── node-deployment.ts
│           └── ip-harvester.ts
├── frontend/                        # داشبورد Next.js
├── docker-compose.yml
├── Dockerfile
└── docs/ (README.fa.md، README.zh.md، README.CREATOR.fa.md)
```

## ⚖️ استفاده‌ی مسئولانه

AriyaeiNetwork نرم‌افزار مدیریت زیرساخت برای اپراتورهایی است که ناوگان VPN/پروکسی
خودشان را اداره می‌کنند. این پروژه هیچ قابلیتی مخصوص دور زدن سیستم‌های ضدسوءاستفاده یا
ضدتقلب سرویس‌های شخص ثالث ندارد و نخواهد داشت. اپراتورها مسئول رعایت قوانین حوزه‌ی
قضایی خود و شرایط استفاده‌ی هر شبکه یا سرویسی هستند که کاربرانشان از طریق آن متصل
می‌شوند.

## 📜 مجوز

MIT © آرمین حامی‌زاده (Armin Hamizadeh)
