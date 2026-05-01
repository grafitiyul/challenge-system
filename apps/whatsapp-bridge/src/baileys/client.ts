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
import { buildMediaStorage } from '../media/factory';
import {
  handleMessagesUpsert,
  handleHistorySync,
  handleReactions,
  IngestServices,
} from '../handlers/messages';

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
  // Phase 2 — media storage backend resolved once at boot from env.
  // Reused across every reconnect so we don't re-instantiate an S3
  // client per socket cycle.
  private readonly storage = buildMediaStorage();
  // In-memory connection flag. Source of truth for "is the socket
  // currently usable for sending" — set true on connection.update
  // 'open', cleared on 'close'. Cheaper than reading
  // WhatsAppConnection.status from Postgres on every send, and
  // avoids the race window where the DB row is mid-write.
  private connected = false;

  async start(): Promise<void> {
    this.stopped = false;
    if (this.socket) {
      log.info('client already running, ignoring start()');
      return;
    }
    await this.connect();
  }

  // Returns the in-memory connection flag without touching the socket
  // or the DB. Used by /send to fast-fail with a precise 503 instead
  // of waiting for socket.sendMessage to time out.
  isConnected(): boolean {
    return this.connected && !!this.socket?.user;
  }

  hasSocket(): boolean {
    return this.socket !== null;
  }

  // Phase 3 — outbound text send. Returns the WhatsApp-assigned
  // message id so the API can write an outbound WhatsAppMessage row
  // and dedupe against the upcoming messages.upsert echo via
  // externalMessageId @unique.
  //
  // Distinct error.message strings (callers map these to HTTP codes):
  //   'whatsapp_not_connected' — no usable socket. 503.
  //   'send_timeout'           — Baileys sendMessage hung past the
  //                              internal timeout. 504.
  //   'send_no_message_id'     — Baileys returned without a key.id.
  //   anything else            — Baileys threw. 500 with the raw msg.
  //
  // The internal timeout is set well below the API's 15 s
  // AbortSignal.timeout so the bridge always responds (with a clear
  // code) before the API gives up — eliminating the
  // "operation aborted by timeout" symptom that hides the real cause.
  async sendText(jid: string, text: string): Promise<{ externalMessageId: string }> {
    if (!this.isConnected()) {
      throw new Error('whatsapp_not_connected');
    }
    const SEND_TIMEOUT_MS = 12_000;
    let timer: NodeJS.Timeout | null = null;
    const sendPromise = this.socket!.sendMessage(jid, { text });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('send_timeout')), SEND_TIMEOUT_MS);
    });
    let result;
    try {
      result = await Promise.race([sendPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const id = result?.key?.id;
    if (!id) {
      throw new Error('send_no_message_id');
    }
    return { externalMessageId: id };
  }

  // Disconnect + wipe credentials. The socket is logged out on the
  // WhatsApp side too, freeing the multi-device slot. After this call
  // the bridge is in 'qr_required' state and ready for re-pairing.
  async signOut(): Promise<void> {
    log.warn('admin sign-out requested');
    this.stopped = true;
    this.connected = false;
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

    // Surface what we actually loaded from Postgres. If hasCreds is
    // false here we'll need to pair (Baileys will emit a QR shortly);
    // if it's true, we should be able to resume without QR. The
    // keyCount field tracks how many signal-key rows came along —
    // anything < ~10 on a previously-paired account is a smell that
    // some keys got wiped between sessions.
    log.info(
      { hasCreds: this.auth.hasCreds, keyCount: this.auth.keyCount },
      'auth state loaded',
    );

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

    // ── Phase 2 — message ingestion ──────────────────────────────────
    // Handlers don't throw upward; one bad message never poisons the
    // batch (each ingest is wrapped) and the socket is independent of
    // ingest progress. Storage backend is shared across the lifetime
    // of the bridge process; the socket reference is captured per
    // handler-bind so a reconnect uses the fresh socket.
    const ingestServices: IngestServices = {
      prisma,
      socket,
      storage: this.storage,
      log: pino({ level: config.logLevel, name: 'ingest' }),
    };

    socket.ev.on('messages.upsert', (payload) => {
      void handleMessagesUpsert(ingestServices, payload);
    });
    socket.ev.on('messages.reaction', (reactions) => {
      void handleReactions(ingestServices, reactions);
    });
    socket.ev.on('messaging-history.set', (history) => {
      void handleHistorySync(ingestServices, history);
    });

    log.info({ mediaStorage: this.storage.kind }, 'message handlers wired');
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    // Structured raw log of every connection.update — captures the
    // exact statusCode + Boom error shape that's driving our branch
    // selection below. No credential content is logged. This is what
    // we read when "the bridge says loggedOut but I didn't unlink".
    if (connection || lastDisconnect || qr) {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const errMsg = lastDisconnect?.error?.message;
      log.info(
        {
          connection,
          hasQr: !!qr,
          disconnectCode: code,
          disconnectReasonName: code !== undefined ? describeReason(code) : null,
          disconnectErrMsg: errMsg,
          isLoggedOut: code === DisconnectReason.loggedOut,
        },
        'connection.update',
      );
    }

    if (qr) {
      log.info('qr code emitted; waiting for scan');
      await connState.setQrRequired(prisma, qr);
    }

    if (connection === 'open') {
      this.attempt = 0;
      this.connected = true;
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
      this.connected = false;
      this.clearHealthyTimer();
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reason = describeReason(code);

      // loggedOut (status code 401) is ambiguous at the protocol level:
      //   (a) Real unlink — admin removed the linked device on the
      //       phone, or WhatsApp banned the session. Re-pair required.
      //   (b) Deploy overlap — Railway started the new container while
      //       the old one was still connected. WhatsApp allows only
      //       ONE active socket per linked-device slot, so it kicks one
      //       with 401. As soon as the old container finishes shutting
      //       down, the same creds work again on the next reconnect.
      //
      // The previous implementation auto-wiped creds on loggedOut.
      // Combined with rolling deploys that produced (b), this destroyed
      // valid creds the admin had just paired with — leaving the bridge
      // permanently in `disconnected, reason=loggedOut, attempts=1`
      // because every restart loaded creds-less state and emitted a
      // fresh QR (or the admin saw "disconnected" indefinitely if no
      // one watched the page during the wipe).
      //
      // New policy: NEVER auto-wipe creds. Stop reconnecting and
      // surface the state to the admin. The two outcomes:
      //   - If it was a real unlink: subsequent connects will keep
      //     getting loggedOut. Admin clicks "Sign out / Forget device"
      //     in the UI, which IS the explicit wipe path, then re-pairs.
      //   - If it was a deploy overlap: the next bridge boot loads the
      //     same creds and connects cleanly (the conflicting socket is
      //     gone by then). No admin action needed.
      if (code === DisconnectReason.loggedOut) {
        log.warn(
          { code, reason },
          'connection closed (loggedOut) — keeping creds; admin must click Sign out to wipe + re-pair',
        );
        this.socket = null;
        // Do NOT call this.auth.clear(). Do NOT scheduleReconnect()
        // — repeatedly bouncing off a real loggedOut would just hammer
        // WhatsApp. Set status to disconnected with reason='loggedOut'
        // and stop the loop. The admin UI keys on this exact reason
        // to render the re-pair affordance.
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
