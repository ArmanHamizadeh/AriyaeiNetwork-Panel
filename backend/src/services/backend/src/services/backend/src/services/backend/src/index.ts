/**
 * AriyaeiNetwork — Backend Entry Point
 * Creator: Armin Hamizadeh (آرمین حامی‌زاده)
 *
 * Boots the Fastify REST API, registers routes, starts the Telegram bot,
 * and schedules the recurring background jobs (traffic flush, expiration
 * sweep, IP pool refresh).
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import cron from "node-cron";

import {
  flushTrafficBuffers,
  sweepExpirations,
  ingestTrafficSample,
} from "./services/expiration-engine";
import { refreshAllIps, poolStats } from "./services/ip-harvester";
import {
  oneClickDeploy,
  applyBbrTuning,
  deployCloudflareWarp,
} from "./services/node-deployment";
import "./bot/telegram-bot"; // side-effect: starts polling

const prisma = new PrismaClient();

const app = Fastify({ logger: true });

async function main() {
  await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(",") ?? true });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? "change-me-in-production" });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // ----------------------------------------------------------------
  // Health
  // ----------------------------------------------------------------
  app.get("/health", async () => ({ status: "ok", service: "AriyaeiNetwork" }));

  // ----------------------------------------------------------------
  // Users
  // ----------------------------------------------------------------
  app.get("/api/users", { preHandler: [app.authenticate] }, async () => {
    return prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  });

  app.post("/api/users", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    const user = await prisma.user.create({
      data: {
        username: body.username,
        expirationMode: body.expirationMode,
        validityDuration: body.validityDuration,
        dataQuotaBytes: body.dataQuotaBytes ? BigInt(body.dataQuotaBytes) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        preferredLanguage: body.preferredLanguage ?? "EN",
      },
    });
    reply.code(201).send({ ...user, dataUsedBytes: user.dataUsedBytes.toString() });
  });

  // ----------------------------------------------------------------
  // Traffic ingestion (called by a small collector agent on each node,
  // or a webhook from Xray-core's stats API)
  // ----------------------------------------------------------------
  app.post("/api/traffic/ingest", async (request, reply) => {
    const body = request.body as any;
    await ingestTrafficSample({
      userId: body.userId,
      nodeId: body.nodeId,
      bytesUp: Number(body.bytesUp ?? 0),
      bytesDown: Number(body.bytesDown ?? 0),
      sampledAt: new Date(),
    });
    reply.code(202).send({ accepted: true });
  });

  // ----------------------------------------------------------------
  // Nodes & deployment
  // ----------------------------------------------------------------
  app.get("/api/nodes", { preHandler: [app.authenticate] }, async () => {
    return prisma.node.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.post("/api/nodes/:id/deploy", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      await oneClickDeploy(id, body.protocol, body.options ?? {});
      reply.send({ ok: true });
    } catch (err: any) {
      reply.code(500).send({ ok: false, error: String(err.message ?? err) });
    }
  });

  app.post("/api/nodes/:id/bbr", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await applyBbrTuning(id);
    reply.send({ ok: true });
  });

  app.post("/api/nodes/:id/warp", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    await deployCloudflareWarp(id, body.licenseKey);
    reply.send({ ok: true });
  });

  // ----------------------------------------------------------------
  // IP pool
  // ----------------------------------------------------------------
  app.get("/api/ip-pool/stats", { preHandler: [app.authenticate] }, async () => {
    return poolStats();
  });

  // ----------------------------------------------------------------
  // Cron schedule
  // ----------------------------------------------------------------
  cron.schedule("*/20 * * * * *", async () => {
    try {
      await flushTrafficBuffers();
    } catch (err) {
      app.log.error({ err }, "flushTrafficBuffers failed");
    }
  });

  cron.schedule("* * * * *", async () => {
    try {
      const { expiredCount } = await sweepExpirations();
      if (expiredCount > 0) app.log.info({ expiredCount }, "expiration sweep");
    } catch (err) {
      app.log.error({ err }, "sweepExpirations failed");
    }
  });

  cron.schedule("0 * * * *", async () => {
    try {
      const stats = await refreshAllIps();
      app.log.info({ stats }, "IP pool refresh complete");
    } catch (err) {
      app.log.error({ err }, "refreshAllIps failed");
    }
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`AriyaeiNetwork backend listening on :${port}`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
