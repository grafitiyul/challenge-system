// Bridge entry point.
//
// Boot order:
//   1. Validate env (config.ts throws on missing required vars).
//   2. Connect Prisma (via the singleton db.ts).
//   3. Start the Baileys client. It immediately reads its persisted
//      auth from Postgres; if creds exist it reconnects without a
//      pairing flow, otherwise it emits a QR for the admin UI.
//   4. Start the internal HTTP server for /status, /health, /sign-out.
//
// Graceful shutdown closes the HTTP server first (stops accepting new
// admin commands), then disconnects Prisma. The Baileys socket is
// left to be torn down by Node's process exit — its own destructor is
// reliable enough for SIGTERM, and we don't want to forcibly kill an
// in-flight reconnect timer mid-pair.

import pino from 'pino';
import { config } from './config';
import { prisma, shutdown as shutdownPrisma } from './db';
import { BaileysClient } from './baileys/client';
import { startHttpServer } from './http/server';

const log = pino({ level: config.logLevel, name: 'bridge' });

async function main(): Promise<void> {
  log.info(
    {
      httpPort: config.httpPort,
      mediaStorage: config.mediaStorage,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs,
    },
    'whatsapp-bridge starting',
  );

  await prisma.$connect();
  log.info('prisma connected');

  const client = new BaileysClient();
  await client.start();

  const server = await startHttpServer(client);

  const shutdown = async (signal: string): Promise<void> => {
    log.warn({ signal }, 'shutdown requested');
    try {
      await server.close();
    } catch (err) {
      log.warn({ err }, 'http server close failed');
    }
    try {
      await shutdownPrisma();
    } catch (err) {
      log.warn({ err }, 'prisma disconnect failed');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaughtException');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bridge] fatal:', err);
  process.exit(1);
});
