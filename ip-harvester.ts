/**
 * AriyaeiNetwork — IP Quality & Pool Manager
 * Creator: Armin Hamizadeh (آرمین حامی‌زاده)
 *
 * NOTE ON SCOPE:
 * This module manages a Redis-backed pool of node egress IPs and scores their
 * general network reputation (public DNSBL/blacklist status, latency, ASN
 * type). It intentionally does NOT implement probes specifically designed to
 * detect or evade the anti-abuse / anti-bot systems of individual AI
 * providers (OpenAI, Google Gemini, Anthropic Claude, etc.) — building a tool
 * whose purpose is to defeat those providers' fraud/ban-detection is not
 * something this project includes. What follows is a general-purpose IP
 * hygiene layer that any VPN/proxy panel legitimately needs, independent of
 * any single downstream service.
 */

import { PrismaClient, IpCleanliness, AiProvider } from "@prisma/client";
import Redis from "ioredis";
import dns from "node:dns/promises";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const POOL_KEY = "arya:ippool:clean";
const POOL_KEY_FLAGGED = "arya:ippool:flagged";

// Public DNS-based blacklists (standard, widely-used reputation lists —
// not provider-specific anti-bot systems).
const DNSBL_ZONES = [
  "zen.spamhaus.org",
  "b.barracudacentral.org",
  "bl.spamcop.net",
];

async function isListedOnDnsbl(ip: string, zone: string): Promise<boolean> {
  const reversed = ip.split(".").reverse().join(".");
  try {
    await dns.resolve4(`${reversed}.${zone}`);
    return true; // a resolvable A record means the IP is listed
  } catch {
    return false; // NXDOMAIN => not listed
  }
}

async function measureLatencyMs(ip: string): Promise<number | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(`http://${ip}`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    return Date.now() - start;
  } catch {
    return null;
  }
}

export interface IpQualityReport {
  ip: string;
  listedOnAnyBlacklist: boolean;
  listedZones: string[];
  latencyMs: number | null;
  cleanliness: IpCleanliness;
}

/**
 * Runs a general reputation check against an IP: public blacklist lookups
 * plus a basic latency probe. This is deliberately provider-agnostic.
 */
export async function evaluateIpQuality(ip: string): Promise<IpQualityReport> {
  const listedZones: string[] = [];
  for (const zone of DNSBL_ZONES) {
    if (await isListedOnDnsbl(ip, zone)) listedZones.push(zone);
  }

  const latencyMs = await measureLatencyMs(ip);
  const listedOnAnyBlacklist = listedZones.length > 0;

  const cleanliness: IpCleanliness = listedOnAnyBlacklist
    ? IpCleanliness.FLAGGED
    : IpCleanliness.CLEAN;

  return { ip, listedOnAnyBlacklist, listedZones, latencyMs, cleanliness };
}

/**
 * Persists a quality report and updates the Redis pool sets used for fast
 * "give me a clean IP" lookups by the assignment API.
 */
export async function refreshIpRecord(
  nodeId: string,
  ip: string,
  provider: AiProvider,
  isStatic: boolean
): Promise<void> {
  const report = await evaluateIpQuality(ip);

  await prisma.cleanIp.upsert({
    where: { ipAddress: ip },
    create: {
      ipAddress: ip,
      nodeId,
      provider,
      isStatic,
      cleanliness: report.cleanliness,
      lastCheckedAt: new Date(),
    },
    update: {
      cleanliness: report.cleanliness,
      lastCheckedAt: new Date(),
    },
  });

  if (report.cleanliness === IpCleanliness.CLEAN) {
    await redis.sadd(POOL_KEY, ip);
    await redis.srem(POOL_KEY_FLAGGED, ip);
  } else {
    await redis.sadd(POOL_KEY_FLAGGED, ip);
    await redis.srem(POOL_KEY, ip);
  }
}

/**
 * Re-checks every known IP. Intended to be called on a cron interval
 * (e.g. hourly) from the scheduler in index.ts.
 */
export async function refreshAllIps(): Promise<{ checked: number; clean: number }> {
  const all = await prisma.cleanIp.findMany();
  let clean = 0;
  for (const record of all) {
    await refreshIpRecord(record.nodeId, record.ipAddress, record.provider, record.isStatic);
    const updated = await prisma.cleanIp.findUnique({ where: { id: record.id } });
    if (updated?.cleanliness === IpCleanliness.CLEAN) clean += 1;
  }
  return { checked: all.length, clean };
}

/**
 * Assigns the least-recently-used clean IP from the pool to a user.
 * Returns null if the pool is currently empty.
 */
export async function assignCleanIpToUser(userId: string): Promise<string | null> {
  const ip = await redis.spop(POOL_KEY);
  if (!ip) return null;

  const record = await prisma.cleanIp.findUnique({ where: { ipAddress: ip } });
  if (!record) {
    // Stale pool entry, drop and signal caller to retry.
    return null;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { assignedAiIpId: record.id, aiRoutingEnabled: true },
  });

  // Put it back in the pool if it's meant to be shared (non-static),
  // so multiple users can be routed through the same clean egress IP.
  if (!record.isStatic) {
    await redis.sadd(POOL_KEY, ip);
  }

  return ip;
}

export async function poolStats(): Promise<{ clean: number; flagged: number }> {
  const [clean, flagged] = await Promise.all([
    redis.scard(POOL_KEY),
    redis.scard(POOL_KEY_FLAGGED),
  ]);
  return { clean, flagged };
}
