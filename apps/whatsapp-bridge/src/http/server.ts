// Internal HTTP server for the bridge. Three endpoints in Phase 1:
//   GET  /health      — Railway health check, no auth.
//   GET  /status      — current connection snapshot, auth required.
//   POST /sign-out    — wipe credentials + force re-pair, auth required.
//
// Auth: every endpoint except /health requires
//   Authorization: Bearer <INTERNAL_API_SECRET>
// The shared secret is set on both the API and the bridge's Railway
// services. Calls always go over Railway's private network — the
// bridge is NOT exposed to the public internet.

import Fastify, { FastifyInstance } from 'fastify';
import qrcode from 'qrcode';
import pino from 'pino';
import { config } from '../config';
import { prisma } from '../db';
import { connState } from '../baileys/connection-state';
import type { BaileysClient } from '../baileys/client';

const log = pino({ level: config.logLevel, name: 'http' });

export async function startHttpServer(client: BaileysClient): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
    bodyLimit: 1 * 1024 * 1024, // 1 MB — Phase 1 has no media-in payloads
  });

  // Auth hook for everything except /health. Constant-time compare via
  // === is sufficient here: the secret is high-entropy, the network
  // surface is private, and we're not protecting against side-channel
  // attacks at this layer.
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const header = req.headers.authorization ?? '';
    const expected = `Bearer ${config.internalApiSecret}`;
    if (header !== expected) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  fastify.get('/health', async () => ({ ok: true }));

  fastify.get('/status', async () => {
    const row = await connState.snapshot(prisma);
    if (!row) {
      return {
        status: 'disconnected',
        qr: null,
        qrDataUrl: null,
        phoneJid: null,
        deviceName: null,
        lastQrAt: null,
        lastConnectedAt: null,
        lastDisconnectAt: null,
        lastDisconnectReason: null,
        lastMessageAt: null,
        reconnectAttempts: 0,
      };
    }
    // Render the QR string into a data URL so the admin UI can render
    // it as <img> without pulling a QR library on the frontend. Falls
    // back to the raw string too in case the admin wants to copy it.
    let qrDataUrl: string | null = null;
    if (row.qr) {
      try {
        qrDataUrl = await qrcode.toDataURL(row.qr, {
          margin: 1,
          width: 320,
          errorCorrectionLevel: 'L',
        });
      } catch (err) {
        log.warn({ err }, 'qrcode.toDataURL failed; returning raw qr only');
      }
    }
    return {
      status: row.status,
      qr: row.qr,
      qrDataUrl,
      phoneJid: row.phoneJid,
      deviceName: row.deviceName,
      lastQrAt: row.lastQrAt?.toISOString() ?? null,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectAt: row.lastDisconnectAt?.toISOString() ?? null,
      lastDisconnectReason: row.lastDisconnectReason,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      reconnectAttempts: row.reconnectAttempts,
    };
  });

  fastify.post('/sign-out', async (_req, reply) => {
    try {
      await client.signOut();
      // After sign-out the bridge stays in 'disconnected' until an admin
      // re-pairs (which today means redeploying or hitting a not-yet-
      // built /pair route). Phase 1 keeps it simple: sign out, wait for
      // the next bridge boot to start fresh.
      void client.start().catch((err) => {
        log.error({ err }, 're-start after sign-out failed');
      });
      return { ok: true };
    } catch (err) {
      log.error({ err }, 'sign-out failed');
      reply.code(500).send({ error: 'sign-out failed' });
    }
  });

  await fastify.listen({ host: config.httpHost, port: config.httpPort });
  log.info({ host: config.httpHost, port: config.httpPort }, 'http server listening');
  return fastify;
}
