/**
 * AriyaeiNetwork — Telegram Bot (fa / en / zh)
 * Creator: Armin Hamizadeh (آرمین حامی‌زاده)
 */

import TelegramBot from "node-telegram-bot-api";
import { PrismaClient, Language, UserStatus } from "@prisma/client";
import { issueTrialUser } from "../services/expiration-engine";
import { assignCleanIpToUser } from "../services/ip-harvester";

const prisma = new PrismaClient();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

const bot = new TelegramBot(token, { polling: true });

// ------------------------------------------------------------------
// i18n
// ------------------------------------------------------------------

type Locale = "fa" | "en" | "zh";

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    welcome: "Welcome to AriyaeiNetwork 🪐\nChoose a language to continue.",
    menu: "Main Menu:\n/trial - Get a 24h trial\n/status - Check your subscription\n/renew - Request renewal\n/airoute - Activate dedicated AI routing\n/help - Show this menu",
    trial_issued: "✅ Your 24h trial has been created.\nUsername: {username}\nExpires at: {expiresAt}",
    trial_already: "You already have an active subscription. Use /status to check it.",
    status_none: "You don't have a subscription yet. Use /trial to get one.",
    status_line: "Status: {status}\nMode: {mode}\nExpires: {expires}\nData used: {used} / {quota}",
    renew_request_sent: "🔔 Your renewal request has been sent to the admins.",
    airoute_enabled: "🤖 Dedicated AI routing enabled. Assigned IP: {ip}",
    airoute_none_available: "No clean IP is currently available. Please try again later.",
    airoute_needs_sub: "You need an active subscription before enabling AI routing.",
    broadcast_sent: "📢 Broadcast sent to {count} users.",
    not_admin: "This command is restricted to administrators.",
  },
  fa: {
    welcome: "به AriyaeiNetwork خوش آمدید 🪐\nبرای ادامه، زبان خود را انتخاب کنید.",
    menu: "منوی اصلی:\n/trial - دریافت تست ۲۴ ساعته\n/status - مشاهده وضعیت اشتراک\n/renew - درخواست تمدید\n/airoute - فعال‌سازی مسیر اختصاصی هوش مصنوعی\n/help - نمایش این منو",
    trial_issued: "✅ اشتراک تست ۲۴ ساعته‌ی شما ساخته شد.\nنام کاربری: {username}\nتاریخ انقضا: {expiresAt}",
    trial_already: "شما در حال حاضر یک اشتراک فعال دارید. با /status وضعیت آن را ببینید.",
    status_none: "هنوز اشتراکی ندارید. با دستور /trial یکی دریافت کنید.",
    status_line: "وضعیت: {status}\nحالت انقضا: {mode}\nتاریخ انقضا: {expires}\nحجم مصرفی: {used} / {quota}",
    renew_request_sent: "🔔 درخواست تمدید شما برای مدیران ارسال شد.",
    airoute_enabled: "🤖 مسیر اختصاصی هوش مصنوعی فعال شد. آی‌پی اختصاص‌یافته: {ip}",
    airoute_none_available: "در حال حاضر آی‌پی سالمی در دسترس نیست. کمی بعد دوباره تلاش کنید.",
    airoute_needs_sub: "برای فعال‌سازی مسیر هوش مصنوعی، ابتدا باید یک اشتراک فعال داشته باشید.",
    broadcast_sent: "📢 پیام همگانی برای {count} کاربر ارسال شد.",
    not_admin: "این دستور فقط برای مدیران قابل استفاده است.",
  },
  zh: {
    welcome: "欢迎使用 AriyaeiNetwork 🪐\n请选择语言以继续。",
    menu: "主菜单：\n/trial - 获取24小时试用\n/status - 查看订阅状态\n/renew - 申请续费\n/airoute - 启用专属AI路由\n/help - 显示此菜单",
    trial_issued: "✅ 您的24小时试用已创建。\n用户名：{username}\n到期时间：{expiresAt}",
    trial_already: "您已有一个有效订阅，请使用 /status 查看。",
    status_none: "您还没有订阅，使用 /trial 获取一个。",
    status_line: "状态：{status}\n到期模式：{mode}\n到期时间：{expires}\n已用流量：{used} / {quota}",
    renew_request_sent: "🔔 您的续费请求已发送给管理员。",
    airoute_enabled: "🤖 专属AI路由已启用。分配的IP：{ip}",
    airoute_none_available: "当前没有可用的优质IP，请稍后再试。",
    airoute_needs_sub: "启用AI路由前，您需要先拥有有效订阅。",
    broadcast_sent: "📢 广播已发送给 {count} 位用户。",
    not_admin: "此命令仅限管理员使用。",
  },
};

function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  let str = STRINGS[locale][key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

function toLocale(lang: Language): Locale {
  return lang.toLowerCase() as Locale;
}

async function getOrCreateTelegramUser(chatId: number, username: string) {
  return prisma.user.findFirst({ where: { telegramId: BigInt(chatId) } });
}

// ------------------------------------------------------------------
// Command handlers
// ------------------------------------------------------------------

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, STRINGS.en.welcome, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🇮🇷 فارسی", callback_data: "lang_fa" },
          { text: "🇬🇧 English", callback_data: "lang_en" },
          { text: "🇨🇳 中文", callback_data: "lang_zh" },
        ],
      ],
    },
  });
});

bot.on("callback_query", async (query) => {
  if (!query.data?.startsWith("lang_") || !query.message) return;
  const locale = query.data.replace("lang_", "") as Locale;
  const chatId = query.message.chat.id;

  const langEnum = locale.toUpperCase() as Language;
  await prisma.user.updateMany({
    where: { telegramId: BigInt(chatId) },
    data: { preferredLanguage: langEnum },
  });

  await bot.sendMessage(chatId, t(locale, "menu"));
});

bot.onText(/\/help/, async (msg) => {
  const user = await getOrCreateTelegramUser(msg.chat.id, msg.from?.username ?? "user");
  const locale = toLocale(user?.preferredLanguage ?? Language.EN);
  await bot.sendMessage(msg.chat.id, t(locale, "menu"));
});

bot.onText(/\/trial/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username ?? `tg_${chatId}`;
  const existing = await prisma.user.findFirst({ where: { telegramId: BigInt(chatId) } });
  const locale = toLocale(existing?.preferredLanguage ?? Language.EN);

  if (existing) {
    await bot.sendMessage(chatId, t(locale, "trial_already"));
    return;
  }

  const created = await issueTrialUser({
    username,
    telegramId: BigInt(chatId),
    language: locale.toUpperCase() as "FA" | "EN" | "ZH",
    hours: 24,
  });

  await bot.sendMessage(
    chatId,
    t(locale, "trial_issued", {
      username: created.username,
      expiresAt: created.expiresAt?.toISOString() ?? "-",
    })
  );
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await prisma.user.findFirst({ where: { telegramId: BigInt(chatId) } });
  const locale = toLocale(user?.preferredLanguage ?? Language.EN);

  if (!user) {
    await bot.sendMessage(chatId, t(locale, "status_none"));
    return;
  }

  await bot.sendMessage(
    chatId,
    t(locale, "status_line", {
      status: user.status,
      mode: user.expirationMode,
      expires: user.expiresAt?.toISOString() ?? "-",
      used: user.dataUsedBytes.toString(),
      quota: user.dataQuotaBytes?.toString() ?? "∞",
    })
  );
});

bot.onText(/\/renew/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await prisma.user.findFirst({ where: { telegramId: BigInt(chatId) } });
  const locale = toLocale(user?.preferredLanguage ?? Language.EN);

  // In production this would enqueue a notification to the admin dashboard /
  // admin Telegram channel. Kept simple here as a stub hook point.
  await notifyAdmins(`Renewal request from @${msg.from?.username ?? chatId}`);
  await bot.sendMessage(chatId, t(locale, "renew_request_sent"));
});

bot.onText(/\/airoute/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await prisma.user.findFirst({ where: { telegramId: BigInt(chatId) } });
  const locale = toLocale(user?.preferredLanguage ?? Language.EN);

  if (!user || user.status !== UserStatus.ACTIVE) {
    await bot.sendMessage(chatId, t(locale, "airoute_needs_sub"));
    return;
  }

  const ip = await assignCleanIpToUser(user.id);
  if (!ip) {
    await bot.sendMessage(chatId, t(locale, "airoute_none_available"));
    return;
  }

  await bot.sendMessage(chatId, t(locale, "airoute_enabled", { ip }));
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const admin = await prisma.admin.findFirst({ where: { telegramId: BigInt(chatId) } });
  const message = match?.[1] ?? "";

  if (!admin) {
    await bot.sendMessage(chatId, t("en", "not_admin"));
    return;
  }

  const users = await prisma.user.findMany({
    where: { telegramId: { not: null } },
    select: { telegramId: true, preferredLanguage: true },
  });

  let sent = 0;
  for (const u of users) {
    if (!u.telegramId) continue;
    try {
      await bot.sendMessage(Number(u.telegramId), message);
      sent += 1;
    } catch {
      // user may have blocked the bot; skip silently
    }
  }

  await prisma.broadcast.create({
    data: { adminId: admin.id, messageEn: message, recipients: sent },
  });

  await bot.sendMessage(chatId, t("en", "broadcast_sent", { count: sent }));
});

async function notifyAdmins(text: string): Promise<void> {
  const admins = await prisma.admin.findMany({ where: { telegramId: { not: null } } });
  for (const admin of admins) {
    if (!admin.telegramId) continue;
    try {
      await bot.sendMessage(Number(admin.telegramId), `[AriyaeiNetwork] ${text}`);
    } catch {
      // ignore delivery failures to individual admins
    }
  }
}

export { bot };
