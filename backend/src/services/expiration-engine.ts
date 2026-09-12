/**
 * AriyaeiNetwork — Expiration Engine
 * Creator: Armin Hamizadeh (آرمین حامی‌زاده)
 *
 * Responsible for:
 *  - Ingesting traffic samples from Xray-core / Sing-box stats API
 *  - Resolving "first byte" events into a locked-in expiry for FIRST_CONNECT users
 *  - Enforcing VOLUME_ONLY caps
 *  - Sweeping the DB on a cron tick to flip ACTIVE -> EXPIRED
 */

import { PrismaClient, ExpirationMode, UserStatus, User } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

// Redis used as a fast write-behind buffer for traffic counters so we don't
// hammer Postgres on every stats poll (which can happen every 5-10s per node).
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const FIRST_CONNECT_LOCK_PREFIX = "arya:firstconnect:lock:";
const TRAFFIC_BUFFER_PREFIX = "arya:traffic:buf:"; // userId -> {up, down} pending flush

export interface TrafficSample {
  userId: string;
  nodeId: string;
  bytesUp: number;
  bytesDown: number;
  sampledAt: Date;
}

/**
 * Called for every stats sample pulled from a node's Xray/Sing-box API.
 * This is the single entry point that can trigger a "first connect" lock-in.
 */
export async function ingestTrafficSample(sample: TrafficSample): Promise<void> {
  const totalBytes = sample.bytesUp + sample.bytesDown;
  if (totalBytes <= 0) return;

  // Buffer traffic in Redis; a separate flusher (see flushTrafficBuffers)
  // periodically commits these into TrafficLog + User.dataUsedBytes.
  const bufKey = `${TRAFFIC_BUFFER_PREFIX}${sample.userId}`;
  await redis
    .multi()
    .hincrby(bufKey, "up", sample.bytesUp)
    .hincrby(bufKey, "down", sample.bytesDown)
    .expire(bufKey, 3600)
    .exec();

  await maybeLockFirstConnect(sample.userId, sample.sampledAt);
}

/**
 * Atomically ensures we only ever set firstConnectAt / expiresAt ONCE per user,
 * even under concurrent stat pollers from multiple nodes. Uses a Redis SETNX
 * lock so the expensive DB write only happens on the winning caller.
 */
async function maybeLockFirstConnect(userId: string, observedAt: Date): Promise<void> {
  const lockKey = `${FIRST_CONNECT_LOCK_PREFIX}${userId}`;
  const acquired = await redis.set(lockKey, "1", "EX", 60 * 60 * 24 * 30, "NX");
  if (!acquired) return; // someone already processed (or is processing) this user

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  if (user.expirationMode !== ExpirationMode.FIRST_CONNECT) {
    // Not relevant for this mode; release the lock key immediately, it was
    // only a guard against duplicate work, not a semantic requirement here.
    return;
  }

  if (user.firstConnectAt) {
    return; // already locked in by an earlier, faster path
  }

  const durationSeconds = user.validityDuration ?? 0;
  const expiresAt = new Date(observedAt.getTime() + durationSeconds * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstConnectAt: observedAt,
      expiresAt,
      status: UserStatus.ACTIVE,
    },
  });
}

/**
 * Flushes buffered Redis traffic counters into Postgres. Run on a short
 * interval (e.g. every 15-30s) from the cron scheduler in index.ts.
 */
export async function flushTrafficBuffers(): Promise<void> {
  const keys = await redis.keys(`${TRAFFIC_BUFFER_PREFIX}*`);
  if (keys.length === 0) return;

  for (const key of keys) {
    const userId = key.slice(TRAFFIC_BUFFER_PREFIX.length);
    const buf = await redis.hgetall(key);
    if (!buf.up && !buf.down) continue;

    const up = BigInt(buf.up ?? "0");
    const down = BigInt(buf.down ?? "0");
    const total = up + down;
    if (total === BigInt(0)) {
      await redis.del(key);
      continue;
    }

    await prisma.$transaction([
      prisma.trafficLog.create({
        data: { userId, bytesUp: up, bytesDown: down, nodeId: null },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { dataUsedBytes: { increment: total } },
      }),
    ]);

    await redis.del(key);
  }
}

/**
 * Core expiry sweep. Called every minute by the cron scheduler.
 * Evaluates every mode independently since each has different resolution logic.
 */
export async function sweepExpirations(): Promise<{ expiredCount: number }> {
  const now = new Date();
  let expiredCount = 0;

  // FIXED_DATE and locked-in FIRST_CONNECT / TEMPORARY_TEST users:
  // straightforward — expiresAt has already been resolved to an absolute date.
  const dateExpired = await prisma.user.updateMany({
    where: {
      status: UserStatus.ACTIVE,
      expiresAt: { lte: now },
      expirationMode: {
        in: [
          ExpirationMode.FIXED_DATE,
          ExpirationMode.FIRST_CONNECT,
          ExpirationMode.TEMPORARY_TEST,
        ],
      },
    },
    data: { status: UserStatus.EXPIRED },
  });
  expiredCount += dateExpired.count;

  // VOLUME_ONLY: must compare dataUsedBytes vs dataQuotaBytes row by row,
  // since Prisma can't compare two columns directly in updateMany.
  const volumeCandidates = await prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE,
      expirationMode: ExpirationMode.VOLUME_ONLY,
      dataQuotaBytes: { not: null },
    },
    select: { id: true, dataUsedBytes: true, dataQuotaBytes: true },
  });

  const volumeExpiredIds = volumeCandidates
    .filter((u) => u.dataQuotaBytes !== null && u.dataUsedBytes >= u.dataQuotaBytes)
    .map((u) => u.id);

  if (volumeExpiredIds.length > 0) {
    const res = await prisma.user.updateMany({
      where: { id: { in: volumeExpiredIds } },
      data: { status: UserStatus.EXPIRED },
    });
    expiredCount += res.count;
  }

  // Any mode with a data quota set (secondary cap) also gets checked, even
  // if the primary mode is not VOLUME_ONLY (e.g. a FIXED_DATE user who also
  // has a hard data ceiling).
  const secondaryCapCandidates = await prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE,
      expirationMode: { not: ExpirationMode.VOLUME_ONLY },
      dataQuotaBytes: { not: null },
    },
    select: { id: true, dataUsedBytes: true, dataQuotaBytes: true },
  });
  const secondaryExpiredIds = secondaryCapCandidates
    .filter((u) => u.dataQuotaBytes !== null && u.dataUsedBytes >= u.dataQuotaBytes)
    .map((u) => u.id);
  if (secondaryExpiredIds.length > 0) {
    const res = await prisma.user.updateMany({
      where: { id: { in: secondaryExpiredIds } },
      data: { status: UserStatus.EXPIRED },
    });
    expiredCount += res.count;
  }

  return { expiredCount };
}

/**
 * Provisions a brand new TEMPORARY_TEST (trial) user with a 24h window that
 * starts ticking immediately (not on first connect) — used by the Telegram bot.
 */
export async function issueTrialUser(params: {
  username: string;
  telegramId?: bigint;
  language: "FA" | "EN" | "ZH";
  hours?: number;
}): Promise<User> {
  const hours = params.hours ?? 24;
  const now = new Date();
  return prisma.user.create({
    data: {
      username: params.username,
      telegramId: params.telegramId,
      preferredLanguage: params.language,
      expirationMode: ExpirationMode.TEMPORARY_TEST,
      status: UserStatus.ACTIVE,
      firstConnectAt: now,
      validityDuration: hours * 3600,
      expiresAt: new Date(now.getTime() + hours * 3600 * 1000),
    },
  });
}

export async function shutdown(): Promise<void> {
  await redis.quit();
  await prisma.$disconnect();
}
