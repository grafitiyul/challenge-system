// Baileys connection manager — Phase 1.
//
// What this DOES:
//   - Boot a Baileys socket using the Postgres-backed auth state.
//   - Persist QR codes + connection status to WhatsAppConnection so the
//     admin UI can render them without talking to Baileys directly.
//   - Reconnect with exponential backoff after non-loggedOut closures.
//   - Stop reconnecting + set status='qr_required' on a loggedOut close
//     so the operator knows a re-pair is needed.
//   - Expose a public-API for admin sign-out.
//
// What this DOES NOT YET DO (Phases 2/3):
//   - Ingest messages.upsert into WhatsAppMessage.
//   - Download media to R2 / disk.
//   - Outbound /send.
//   - History sync replay.
//
// Reconnect math:
//   delay = min(maxDelay, minDelay * 2^attempt)
// Reset attempts to 0 after the connection has stayed open ≥ healthyMs.

import { Boom } from '@hapi/boom';
import baileys, {
  Browsers,
  ConnectionState,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config';
import { prisma } from '../db';
import { makePostgresAuthState, PostgresAuthHandle } from './auth-store';
import { connState } from './connection-state';

const log = pino({ level: config.logLevel, name: 'baileys' });

// `baileys` exports a default factory; the bundled typings sometimes
// export it as `default` and sometimes as a property. The `as any` is
// scoped tightly here — every other interaction with the socket goes
// through the strongly-typed WASocket return type.
const makeWASocket = (
  baileys as unknown as { default: typeof baileys } & typeof baileys
).default ?? baileys;

export class BaileysClient {
  private socket: WASocket | null = null;
  private auth: PostgresAuthHandle | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthyTimer: NodeJS.Timeout | null = null;
  // Tracks whether a loggedOut event told us to stop trying to
  // reconnect. Cleared by an explicit start() (e.g. after admin signs
  // out and re-pairs).
  private stopped = false;
  // Backoff attempt counter. Lives in memory; the persisted version on
  // WhatsAppConnection.reconnectAttempts is for the admin UI only.
  private attempt = 0;

  async start(): Promise<void> {
    this.stopped = false;
    if (this.socket) {
      log.info('client already running, ignoring start()');
      return;
    }
    await this.connect();
  }

  // Disconnect + wipe credentials. The socket is logged out on the
  // WhatsApp side too, freeing the multi-device slot. After this call
  // the bridge is in 'qr_required' state and ready for re-pairing.
  async signOut(): Promise<void> {
    log.warn('admin sign-out requested');
    this.stopped = true;
    this.clearTimers();
    try {
      await this.socket?.logout('admin sign-out');
    } catch (err) {
      log.warn({ err }, 'logout() failed; proceeding with local wipe');
    }
    this.socket = null;
    if (this.auth) {
      await this.auth.clear();
      this.auth = null;
    }
    await connState.setDisconnected(prisma, 'signed_out', {
      incrementAttempts: false,
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    await connState.setConnecting(prisma);
    this.auth = await makePostgresAuthState(prisma);

    // Pull the recommended Baileys protocol version. Bundled fallback
    // is fine if WhatsApp's update endpoint is unreachable; Baileys
    // returns a sensible default.
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log.info({ version, isLatest }, 'starting socket');

    const socket = makeWASocket({
      version,
      auth: this.auth.state,
      // Visible name when the linked-device row appears on the phone.
      browser: Browsers.appropriate('Challenge System Bridge'),
      // Phase 1: no history sync yet (we'll wire `messaging-history.set`
      // in Phase 4). This flag asks WhatsApp to send a smaller initial
      // history bundle on first pair, which is what we want.
      syncFullHistory: false,
      // Pino logger; Baileys is chatty at debug — keep at 'warn' unless
      // explicitly asked.
      logger: pino({ level: 'warn', name: 'baileys-internal' }) as never,
      // Don't auto-print QR to terminal; we render it from the persisted
      // qr field in the admin UI.
      printQRInTerminal: false,
    });
    this.socket = socket;

    socket.ev.on('creds.update', async () => {
      // Baileys mutates state.creds in-place and emits this event.
      // Our auth handle calls saveCreds() which round-trips via
      // BufferJSON.
      try {
        await this.auth?.saveCreds();
      } catch (err) {
        log.error({ err }, 'saveCreds failed');
      }
    });

    socket.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(update);
    });
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log.info('qr code emitted; waiting for scan');
      await connState.setQrRequired(prisma, qr);
    }

    if (connection === 'open') {
      this.attempt = 0;
      const me = this.socket?.user;
      log.info({ jid: me?.id, name: me?.name }, 'connected');
      await connState.setConnected(prisma, {
        phoneJid: me?.id ?? null,
        deviceName: me?.name ?? null,
      });
      // Schedule a "healthy" checkpoint that resets reconnectAttempts
      // after the connection stays open long enough.
      this.clearHealthyTimer();
      this.healthyTimer = setTimeout(() => {
        void connState.markHealthy(prisma);
      }, config.reconnectHealthyMs);
    }

    if (connection === 'close') {
      this.clearHealthyTimer();
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reason = describeReason(code);

      // loggedOut means the phone forced a sign-out (admin removed the
      // linked device, or WhatsApp banned the session). Don't loop —
      // wipe creds and surface qr_required so the admin re-pairs.
      if (code === DisconnectReason.loggedOut) {
        log.warn({ code, reason }, 'connection closed (loggedOut)');
        this.socket = null;
        if (this.auth) {
          await this.auth.clear();
          this.auth = null;
        }
        await connState.setDisconnected(prisma, reason, {
          incrementAttempts: false,
        });
        return;
      }

      // restartRequired (status code 515) is a routine WhatsApp protocol
      // signal — emitted right after the multi-device pairing handshake
      // completes ("now reopen on the encrypted channel") and
      // occasionally mid-session when WhatsApp wants the socket
      // renegotiated. It's not a fault: we shouldn't bump the backoff
      // counter, shouldn't record it as a disconnect reason in the UI,
      // and shouldn't wait — Baileys is already telling us the right
      // thing to do is reopen immediately. Treating it as a regular
      // disconnect made the admin UI permanently show "סיבת ניתוק:
      // restartRequired" even on a perfectly stable connection.
      if (code === DisconnectReason.restartRequired) {
        log.info({ code }, 'restartRequired — reopening socket immediately (routine post-handshake signal)');
        this.socket = null;
        // No setDisconnected, no backoff increment, no scheduleReconnect.
        // Connect straight through. If the immediate reconnect itself
        // fails, fall back to the normal backoff path.
        void this.connect().catch((err) => {
          log.error({ err }, 'restartRequired reconnect failed; entering backoff');
          void connState.setDisconnected(prisma, 'restartRequired_reconnect_failed');
          this.scheduleReconnect();
        });
        return;
      }

      log.warn({ code, reason }, 'connection closed');
      this.socket = null;
      await connState.setDisconnected(prisma, reason);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const exp = Math.min(
      config.reconnectMaxDelayMs,
      config.reconnectMinDelayMs * Math.pow(2, this.attempt),
    );
    this.attempt++;
    log.info({ delayMs: exp, attempt: this.attempt }, 'scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => {
        log.error({ err }, 'reconnect failed; rescheduling');
        this.scheduleReconnect();
      });
    }, exp);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHealthyTimer();
  }

  private clearHealthyTimer(): void {
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
  }
}

function describeReason(code: number | undefined): string {
  if (code === undefined) return 'unknown';
  for (const [name, value] of Object.entries(DisconnectReason)) {
    if (typeof value === 'number' && value === code) return name;
  }
  return `code_${code}`;
}
