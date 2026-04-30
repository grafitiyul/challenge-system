// Single-row WhatsAppConnection persistence helper. id='singleton' is
// hard-coded into the schema's @default; every operation is an upsert
// keyed on that id.
//
// The bridge calls these from event handlers to mirror the live
// Baileys connection state into Postgres. The admin UI then reads the
// row directly (via the API proxy) without ever talking to Baileys —
// keeping the UI's polling cheap and decoupled from socket hiccups.

import type { PrismaClient } from '@prisma/client';

export type ConnStatus =
  | 'disconnected'
  | 'qr_required'
  | 'pairing'
  | 'connecting'
  | 'connected';

const SINGLETON_ID = 'singleton';

async function upsert(
  prisma: PrismaClient,
  data: Record<string, unknown>,
): Promise<void> {
  await prisma.whatsAppConnection.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, status: 'disconnected', ...data },
    update: data,
  });
}

export const connState = {
  async setConnecting(prisma: PrismaClient): Promise<void> {
    await upsert(prisma, { status: 'connecting', qr: null });
  },

  async setQrRequired(prisma: PrismaClient, qr: string): Promise<void> {
    await upsert(prisma, {
      status: 'qr_required',
      qr,
      lastQrAt: new Date(),
    });
  },

  async setConnected(
    prisma: PrismaClient,
    info: { phoneJid?: string | null; deviceName?: string | null },
  ): Promise<void> {
    await upsert(prisma, {
      status: 'connected',
      qr: null,
      phoneJid: info.phoneJid ?? null,
      deviceName: info.deviceName ?? null,
      lastConnectedAt: new Date(),
      reconnectAttempts: 0,
      // Clear the previous disconnect reason once we've recovered.
      // Without this, a routine post-pairing restartRequired (or any
      // transient close) lingers in the UI alongside status='connected',
      // making it look like something is wrong when it isn't.
      // lastDisconnectAt is intentionally NOT cleared — the admin
      // benefits from seeing "we had a blip at 14:30 (recovered)" as
      // historical breadcrumb.
      lastDisconnectReason: null,
    });
  },

  async setDisconnected(
    prisma: PrismaClient,
    reason: string,
    options: { incrementAttempts: boolean } = { incrementAttempts: true },
  ): Promise<void> {
    if (options.incrementAttempts) {
      // Increment in the same statement so concurrent disconnect events
      // don't race the read-then-write pattern. Use updateMany for the
      // increment + a downstream upsert for the rest.
      await prisma.whatsAppConnection.updateMany({
        where: { id: SINGLETON_ID },
        data: { reconnectAttempts: { increment: 1 } },
      });
    }
    await upsert(prisma, {
      status: 'disconnected',
      qr: null,
      lastDisconnectAt: new Date(),
      lastDisconnectReason: reason,
    });
  },

  // Reset reconnectAttempts after the connection has stayed open long
  // enough to be considered healthy. Backoff returns to its minimum.
  async markHealthy(prisma: PrismaClient): Promise<void> {
    await prisma.whatsAppConnection.updateMany({
      where: { id: SINGLETON_ID },
      data: { reconnectAttempts: 0 },
    });
  },

  async heartbeat(prisma: PrismaClient): Promise<void> {
    await prisma.whatsAppConnection.updateMany({
      where: { id: SINGLETON_ID },
      data: { lastMessageAt: new Date() },
    });
  },

  async snapshot(prisma: PrismaClient) {
    return prisma.whatsAppConnection.findUnique({ where: { id: SINGLETON_ID } });
  },
};
