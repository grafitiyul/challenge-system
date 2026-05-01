// Internal HTTP server for the bridge. Endpoints:
//   GET  /health      — Railway health check, no auth.
//   GET  /status      — current connection snapshot, auth required.
//   POST /sign-out    — wipe credentials + force re-pair, auth required.
//   POST /send        — outbound text message, auth required.
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

  // ── Global incoming-request log ─────────────────────────────────
  // Fires on EVERY request, before the auth hook below. Lets us see
  // 404s, malformed paths, and Railway-edge probes that the auth
  // hook would otherwise short-circuit invisibly. The line shape is
  // deliberately greppable: "incoming method=GET url=/health".
  fastify.addHook('onRequest', async (req) => {
    log.info(
      { method: req.method, url: req.url },
      `incoming method=${req.method} url=${req.url}`,
    );
  });

  // ── Auth hook ───────────────────────────────────────────────────
  // Runs after the incoming-log hook. Bypassed for /health so the
  // Railway probe + curl reachability test work without a secret.
  // Constant-time compare via === is sufficient here: the secret is
  // high-entropy, the network surface is private, and we're not
  // protecting against side-channel attacks at this layer. Auth
  // failures are logged so a misconfigured INTERNAL_API_SECRET on the
  // API side doesn't manifest as silent 401s.
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const header = req.headers.authorization ?? '';
    const expected = `Bearer ${config.internalApiSecret}`;
    if (header !== expected) {
      log.warn(
        { path: req.url, method: req.method, hasHeader: !!req.headers.authorization },
        'bridge auth rejected',
      );
      reply.code(401).send({ error: 'bridge_auth_failed' });
    }
  });

  // ── 404 handler ─────────────────────────────────────────────────
  // Fastify's default 404 response is a JSON body, but Railway's
  // edge proxy / browser intermediaries can transform empty
  // responses into plain "Not Found" text — making it look like
  // the route doesn't exist when actually the request never reached
  // it (proxy mismatch, port mismatch, etc.). Explicit handler with
  // a clear log line + structured JSON body so the operator can
  // tell from the bridge log whether the request actually hit the
  // app or was lost upstream.
  fastify.setNotFoundHandler((req, reply) => {
    log.warn(
      { method: req.method, url: req.url },
      `404 not_found method=${req.method} url=${req.url}`,
    );
    reply.code(404).send({
      error: 'not_found',
      method: req.method,
      url: req.url,
      // List the routes the bridge DOES expose so the operator can
      // see at a glance whether their probe URL matches anything.
      registeredRoutes: ['GET /health', 'GET /status', 'POST /send', 'POST /sign-out', 'POST /restart-socket'],
    });
  });

  // GET /health — Railway probe + reachability test from the API.
  // No auth; intentionally cheap so it can be polled aggressively.
  // `connected` mirrors BaileysClient.isConnected() so a `curl`
  // against /health from the API service answers two questions in
  // one shot: "is the bridge process up?" (HTTP 200 at all) and
  // "is WhatsApp currently linked?" (the boolean).
  fastify.get('/health', async () => {
    log.info('[/health] received');
    return {
      ok: true,
      connected: client.isConnected(),
    };
  });

  fastify.get('/status', async () => {
    // Roll up everything the admin UI shows in one call:
    //   - the singleton WhatsAppConnection row (status, qr, errors)
    //   - today's message + media counters by provider='baileys'
    // Two queries; both are indexed and run in parallel. If we ever
    // need more metrics the right place is here, not separate routes.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [row, messagesToday, mediaToday] = await Promise.all([
      connState.snapshot(prisma),
      prisma.whatsAppMessage.count({
        where: { provider: 'baileys', createdAt: { gte: todayStart } },
      }),
      prisma.whatsAppMessage.count({
        where: {
          provider: 'baileys',
          createdAt: { gte: todayStart },
          mediaUrl: { not: null },
        },
      }),
    ]);
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
        lastMediaError: null,
        lastMediaErrorAt: null,
        messagesToday: 0,
        mediaToday: 0,
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
      lastMediaError: row.lastMediaError,
      lastMediaErrorAt: row.lastMediaErrorAt?.toISOString() ?? null,
      messagesToday,
      mediaToday,
    };
  });

  // POST /send  { phone: "972..." | "...@s.whatsapp.net" | "...@g.us", message: string }
  //
  // Phase 3 — outbound text. Each request walks through a fixed
  // sequence of checkpoints, each emitting one INFO line (or one
  // ERROR line on failure). The Railway log for a single attempt
  // therefore tells the full story:
  //
  //   [/send] received                     (HTTP entered, auth passed)
  //   [/send] payload jidShape=… phoneTail=… len=…
  //   [/send] socket present=true connected=true
  //   [/send] socket.sendMessage starting
  //   [/send] socket.sendMessage succeeded externalMessageId=…
  //   [/send] outbound row persisted
  //
  // Or one of the failure paths:
  //   [/send] invalid_payload reason=…             → 400 invalid_payload
  //   [/send] whatsapp_not_connected hasSocket=…   → 503 whatsapp_not_connected
  //   [/send] send_timeout after Nms               → 504 send_timeout
  //   [/send] send_failed name=… message=…         → 500 send_failed
  //
  // Logging policy: phone is masked to last-4-digits + jidShape;
  // message contents NEVER logged; only length + the externalMessageId.
  fastify.post<{
    Body: { phone?: string; message?: string };
  }>('/send', async (req, reply) => {
    const startedAt = Date.now();
    log.info('[/send] received');

    // ── Step 1: payload validation ───────────────────────────────────
    const { phone, message } = req.body ?? {};
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      log.warn({ reason: 'phone_required' }, '[/send] invalid_payload');
      reply.code(400).send({ error: 'invalid_payload', reason: 'phone_required' });
      return;
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      log.warn({ reason: 'message_required' }, '[/send] invalid_payload');
      reply.code(400).send({ error: 'invalid_payload', reason: 'message_required' });
      return;
    }
    const trimmedMessage = message.trim();
    const jid = normaliseToJid(phone.trim());
    if (!jid) {
      log.warn({ reason: 'phone_invalid', phoneTail: lastFourDigits(phone) }, '[/send] invalid_payload');
      reply.code(400).send({ error: 'invalid_payload', reason: 'phone_invalid' });
      return;
    }
    log.info(
      { jidShape: shapeFor(jid), phoneTail: lastFourDigits(jid), length: trimmedMessage.length },
      '[/send] payload',
    );

    // ── Step 2: socket / connection state ────────────────────────────
    // Full readiness snapshot for the bridge log. Includes wsState
    // (raw websocket readyState), connection age, last
    // connection.update, last disconnect reason, and any staleReason
    // a previous send marked. ok=false → fast-fail with the precise
    // reason instead of waiting for socket.sendMessage to time out.
    const readiness = client.getReadiness();
    log.info(readiness, '[/send] socket readiness');
    if (!readiness.ok) {
      log.warn({ readiness }, '[/send] whatsapp_not_connected');
      reply.code(503).send({
        error: 'whatsapp_not_connected',
        reason: readiness.reason,
        readiness,
      });
      return;
    }

    // ── Step 3: hand off to Baileys (with internal timeout) ──────────
    let externalMessageId: string;
    try {
      log.info('[/send] socket.sendMessage starting');
      const result = await client.sendText(jid, trimmedMessage);
      externalMessageId = result.externalMessageId;
      log.info(
        { externalMessageId, elapsedMs: Date.now() - startedAt },
        '[/send] socket.sendMessage succeeded',
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : 'send_failed';
      // Distinct branches per code so the bridge logs and the HTTP
      // status code line up with the API proxy's mapping.
      if (code === 'whatsapp_not_connected') {
        // Race: socket dropped between the isConnected() check and
        // sendText. Treat as 503, same surface as Step 2.
        log.warn('[/send] whatsapp_not_connected (raced after isConnected check)');
        reply.code(503).send({ error: 'whatsapp_not_connected' });
        return;
      }
      if (code === 'send_timeout') {
        // BaileysClient.sendText already kicked off
        // markStaleAndReconnect() before throwing. Surface that to
        // the caller so the admin UI can render "WhatsApp connection
        // was stale, reconnect started" instead of a generic timeout.
        log.error(
          { elapsedMs: Date.now() - startedAt, reconnect_started: true },
          '[/send] send_timeout — socket marked stale; reconnect started',
        );
        reply.code(504).send({ error: 'send_timeout', reconnect_started: true });
        return;
      }
      // Anything else: capture name + message + stack at error level
      // for the operator. The HTTP body carries a SAFE error message
      // (no stack, no sensitive details) so the admin UI shows it.
      const errName = err instanceof Error ? err.name : 'unknown';
      const errMessage = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      log.error(
        {
          jidShape: shapeFor(jid),
          name: errName,
          message: errMessage,
          stack: errStack,
          elapsedMs: Date.now() - startedAt,
        },
        '[/send] send_failed',
      );
      reply.code(500).send({
        error: 'send_failed',
        // safe message: first line of the error, capped, no stack.
        detail: errMessage.split('\n')[0]?.slice(0, 240) ?? 'send_failed',
      });
      return;
    }

    // ── Step 4: persist outbound row (non-fatal if it fails) ─────────
    try {
      const chat = await upsertOutboundChat(jid);
      await prisma.whatsAppMessage.upsert({
        where: { externalMessageId },
        create: {
          externalMessageId,
          chatId: chat.id,
          direction: 'outgoing',
          senderName: null,
          senderPhone: null,
          messageType: 'text',
          textContent: trimmedMessage,
          mediaUrl: null,
          mediaMimeType: null,
          mediaSizeBytes: null,
          mediaOriginalName: null,
          quotedExternalId: null,
          timestampFromSource: new Date(),
          rawPayload: { source: 'bridge_send', jidShape: shapeFor(jid) } as never,
          provider: 'baileys',
        },
        update: {
          // Echo from messages.upsert may complete the row first; if
          // so, we leave whatever's there alone. Both writes carry
          // the same externalMessageId so the row exists either way.
        },
      });
      await prisma.whatsAppChat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });
      await prisma.whatsAppConnection.updateMany({
        where: { id: 'singleton' },
        data: { lastMessageAt: new Date() },
      });
      log.info({ externalMessageId }, '[/send] outbound row persisted');
    } catch (err) {
      // The send already succeeded on WhatsApp's side; persistence
      // failure is non-fatal for the API contract. The messages.upsert
      // echo will create the row when the response comes back.
      log.warn(
        { err: errSummary(err), externalMessageId },
        '[/send] outbound row persist failed; relying on echo',
      );
    }

    log.info(
      { externalMessageId, elapsedMs: Date.now() - startedAt },
      '[/send] complete',
    );
    reply.code(200).send({ ok: true, externalMessageId });
  });

  // POST /restart-socket — admin-triggered socket rebuild WITHOUT
  // wiping creds. Use case: the bridge says connected=true but
  // sendMessage hangs (zombie ws), and the admin wants to recover
  // without a redeploy. Internally identical to the timeout-driven
  // reconnect path: tear down the current socket, drop the in-memory
  // readiness flags, call connect() with backoff reset.
  fastify.post('/restart-socket', async (_req, reply) => {
    log.warn('[/restart-socket] requested');
    try {
      // Fire-and-forget: returning before the new socket reaches
      // 'open' is fine — the admin UI re-checks /status afterward.
      void client.restartSocket().catch((err) => {
        log.error({ err: errSummary(err) }, '[/restart-socket] async failure');
      });
      const readiness = client.getReadiness();
      reply.code(202).send({ ok: true, restart_started: true, readiness });
    } catch (err) {
      log.error({ err: errSummary(err) }, '[/restart-socket] failed');
      reply.code(500).send({ error: 'restart_failed', detail: errSummary(err) });
    }
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
  // Explicit string format so the line is greppable in plain-text
  // logs (Railway's default rendering shows pino structured logs as
  // JSON; the host/port fields are still present but a literal
  // "host=… port=…" line is faster to spot when triaging
  // reachability issues like "fetch failed").
  log.info(
    { host: config.httpHost, port: config.httpPort },
    `http server listening host=${config.httpHost} port=${config.httpPort}`,
  );

  // Authoritative dump of every registered route. If the production
  // /health endpoint ever returns "Not Found" again, the boot log
  // immediately answers "was the route registered or not". The
  // printed format is multi-line; we log it inside a single log
  // entry so Railway's renderer keeps it together.
  const routesTable = fastify.printRoutes({ commonPrefix: false });
  log.info(`registered routes:\n${routesTable}`);
  return fastify;
}

// ─── Helpers ─────────────────────────────────────────────────────────

// Convert a raw `phone` field into a WhatsApp JID. Accepted shapes:
//   - "972501234567"            → "972501234567@s.whatsapp.net"
//   - "+972-50-123-4567"        → "972501234567@s.whatsapp.net"
//   - "972501234567@s.whatsapp.net" → kept as-is
//   - "1234-5678@g.us"          → kept as-is (group JID)
// Returns null if the input doesn't have enough digits to be a phone.
function normaliseToJid(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.includes('@s.whatsapp.net') || trimmed.endsWith('@g.us')) {
    return trimmed;
  }
  // Strip everything except digits.
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `${digits}@s.whatsapp.net`;
}

// Find or create the outbound chat row. For private sends the chat may
// not yet exist (we've never received from this number); we create it
// with type='private' and no name. For groups the chat row should
// already exist from inbound traffic; if not, we create a minimal row.
async function upsertOutboundChat(jid: string): Promise<{ id: string }> {
  const existing = await prisma.whatsAppChat.findUnique({
    where: { externalChatId: jid },
    select: { id: true },
  });
  if (existing) return existing;
  const isGroup = jid.endsWith('@g.us');
  const phoneNumber = isGroup ? null : jid.split('@')[0] ?? null;
  return prisma.whatsAppChat.create({
    data: {
      externalChatId: jid,
      type: isGroup ? 'group' : 'private',
      name: null,
      phoneNumber,
      lastMessageAt: new Date(),
      provider: 'baileys',
    },
    select: { id: true },
  });
}

function shapeFor(jid: string): 'private' | 'group' | 'unknown' {
  if (jid.endsWith('@s.whatsapp.net')) return 'private';
  if (jid.endsWith('@g.us')) return 'group';
  return 'unknown';
}

function lastFourDigits(input: string): string {
  return input.replace(/\D/g, '').slice(-4) || '????';
}

function errSummary(err: unknown): string {
  if (err instanceof Error) {
    return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  }
  return String(err).slice(0, 240);
}
