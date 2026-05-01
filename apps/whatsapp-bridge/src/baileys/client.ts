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

// One-line description of what readiness reports for log rendering.
export interface ReadinessSnapshot {
  ok: boolean;
  reason: string | null;          // human-grade reason when !ok ("ws_CLOSED", "stale: send_timeout", …)
  hasSocket: boolean;
  connected: boolean;             // the in-memory flag from connection.update('open')
  hasUser: boolean;               // socket.user is populated post-handshake
  wsState: WsStateName;           // direct read of the underlying websocket
  ageMs: number | null;           // ms since the current socket opened; null when not opened
  lastUpdate: 'open' | 'close' | 'connecting' | null; // last connection.update we observed
  lastDisconnectReason: string | null;                // mirrored from the last close event
  staleReason: string | null;                         // set when this layer marks the socket unusable
  reconnecting: boolean;                              // true while markStaleAndReconnect/restart is in flight
}

type WsStateName = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'unknown';

function wsStateName(raw: unknown): WsStateName {
  switch (raw) {
    case 0: return 'CONNECTING';
    case 1: return 'OPEN';
    case 2: return 'CLOSING';
    case 3: return 'CLOSED';
    default: return 'unknown';
  }
}

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

  // ── Readiness diagnostics ───────────────────────────────────────
  // Tracked alongside `connected` so the /send route can log a full
  // socket-state snapshot, and so getReadiness() can fail closed when
  // the underlying ws is dead even though Baileys hasn't yet emitted
  // a connection.update('close').
  private socketOpenedAt: Date | null = null;
  private lastConnectionUpdate: 'open' | 'close' | 'connecting' | null = null;
  private lastDisconnectReason: string | null = null;
  // Set when this layer (e.g. send_timeout, admin restart) decided
  // the socket is unusable. Cleared on the next connection.update('open').
  private staleReason: string | null = null;
  // True while markStaleAndReconnect/restartSocket is in flight, so
  // concurrent sends or repeated triggers don't pile up multiple
  // socket-rebuild attempts.
  private reconnecting = false;

  // ── Send serialization ──────────────────────────────────────────
  // Baileys is single-socket; concurrent sendMessage calls can
  // interleave key writes against the auth state. Serialize all
  // sendText() invocations through a single Promise chain so at most
  // one socket.sendMessage is ever in flight at once.
  private sendChain: Promise<unknown> = Promise.resolve();

  async start(): Promise<void> {
    this.stopped = false;
    if (this.socket) {
      log.info('client already running, ignoring start()');
      return;
    }
    await this.connect();
  }

  // Stronger than the old in-memory boolean: also inspects the
  // underlying websocket's readyState and a "we marked it stale"
  // flag, so a zombie socket (TCP dead but Baileys hasn't yet emitted
  // 'close') is reported as not-ready instead of letting sendMessage
  // hang for 12s and fire the bridge's send_timeout.
  isConnected(): boolean {
    return this.getReadiness().ok;
  }

  hasSocket(): boolean {
    return this.socket !== null;
  }

  // Full snapshot of every signal we use to decide whether the socket
  // is usable. Returned as-is by /send so a single bridge log line
  // captures the exact state at attempt time. `reason` is null when
  // ok=true; otherwise a short tag pinpointing the failing check.
  getReadiness(): ReadinessSnapshot {
    const socket = this.socket;
    const hasSocket = socket !== null;
    const hasUser = !!socket?.user;
    // Baileys' WASocket exposes `.ws` (the node ws instance) but the
    // public type doesn't include it. Cast narrowly here so we can
    // read readyState without `any`-poisoning the rest of the file.
    const ws = (socket as unknown as { ws?: { readyState?: unknown } } | null)?.ws;
    const wsState = wsStateName(ws?.readyState);
    const ageMs = this.socketOpenedAt
      ? Date.now() - this.socketOpenedAt.getTime()
      : null;

    let reason: string | null = null;
    if (this.reconnecting)        reason = 'reconnecting';
    else if (this.staleReason)    reason = `stale:${this.staleReason}`;
    else if (!hasSocket)          reason = 'no_socket';
    else if (!this.connected)     reason = 'not_connected_flag';
    else if (!hasUser)            reason = 'no_user';
    else if (wsState !== 'OPEN')  reason = `ws_${wsState}`;

    return {
      ok: reason === null,
      reason,
      hasSocket,
      connected: this.connected,
      hasUser,
      wsState,
      ageMs,
      lastUpdate: this.lastConnectionUpdate,
      lastDisconnectReason: this.lastDisconnectReason,
      staleReason: this.staleReason,
      reconnecting: this.reconnecting,
    };
  }

  // Force the socket into a known-bad state and start a fresh connect.
  // Idempotent: concurrent callers see the second call return immediately.
  // Does NOT wait for the new socket to reach 'open' — that happens
  // asynchronously via connection.update; the next send retry checks
  // readiness and either succeeds or fails fast with a fresh reason.
  async markStaleAndReconnect(reason: string): Promise<void> {
    if (this.reconnecting) {
      log.info({ reason }, 'reconnect already in progress; ignoring');
      return;
    }
    if (this.stopped) {
      log.warn({ reason }, 'client stopped; refusing to auto-reconnect');
      return;
    }
    this.reconnecting = true;
    this.connected = false;
    this.staleReason = reason;
    const ageMs = this.socketOpenedAt ? Date.now() - this.socketOpenedAt.getTime() : null;
    log.warn({ reason, ageMs, lastUpdate: this.lastConnectionUpdate }, 'reconnect started');

    // Best-effort socket teardown. We null the field FIRST so any
    // sendText racing with us sees no_socket. Calling end() on an
    // already-dead socket can throw; swallow it.
    const old = this.socket;
    this.socket = null;
    this.socketOpenedAt = null;
    try {
      old?.end(new Error(`bridge_force_reconnect:${reason}`));
    } catch (err) {
      log.warn({ err: errMessage(err) }, 'old socket.end() threw; continuing');
    }

    await connState.setDisconnected(prisma, `stale_socket:${reason}`, {
      incrementAttempts: false,
    });

    // Reset backoff so we connect immediately rather than waiting on
    // the previous attempt counter.
    this.attempt = 0;
    this.clearTimers();

    try {
      await this.connect();
      log.info({ reason }, 'reconnect completed (connect() returned; awaiting open)');
    } catch (err) {
      log.error({ err: errMessage(err), reason }, 'reconnect connect() failed; falling back to scheduled backoff');
      this.scheduleReconnect();
    } finally {
      this.reconnecting = false;
      // staleReason is cleared by connection.update('open') so a
      // pending send doesn't see false-positive readiness during the
      // window between connect() returning and 'open' firing.
    }
  }

  // Admin-triggered restart. Same teardown path as the timeout-driven
  // reconnect; separate method only so the log line and the calling
  // surface are distinct in audit logs.
  async restartSocket(): Promise<void> {
    log.warn('admin restart-socket requested');
    await this.markStaleAndReconnect('admin_restart');
  }

  // Phase 3 — outbound text send. Returns the WhatsApp-assigned
  // message id so the API can write an outbound WhatsAppMessage row
  // and dedupe against the upcoming messages.upsert echo via
  // externalMessageId @unique.
  //
  // Distinct error.message strings (callers map these to HTTP codes):
  //   'whatsapp_not_connected' — no usable socket. 503.
  //   'send_timeout'           — Baileys sendMessage hung past the
  //                              internal timeout. 504. The socket has
  //                              been marked stale and a reconnect was
  //                              kicked off; subsequent sends will
  //                              either succeed or fail fast with a
  //                              fresh, accurate readiness reason.
  //   'send_no_message_id'     — Baileys returned without a key.id.
  //   anything else            — Baileys threw. 500 with the raw msg.
  //
  // The internal timeout is set well below the API's 15 s
  // AbortSignal.timeout so the bridge always responds (with a clear
  // code) before the API gives up — eliminating the
  // "operation aborted by timeout" symptom that hides the real cause.
  async sendText(jid: string, text: string): Promise<{ externalMessageId: string }> {
    // Pre-flight readiness — outside the lock so concurrent senders
    // fail fast on a known-stale socket without serializing first.
    const pre = this.getReadiness();
    if (!pre.ok) {
      log.warn({ readiness: pre }, 'sendText pre-flight readiness failed');
      throw new Error('whatsapp_not_connected');
    }
    return this.withSendLock(() => this.sendTextInner(jid, text));
  }

  // Serializes all sends through a single Promise chain. The chain
  // is `.catch`-suppressed so one failed send doesn't poison the
  // queue and freeze every subsequent caller.
  private withSendLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.sendChain.then(fn, fn);
    this.sendChain = next.catch(() => undefined);
    return next;
  }

  private async sendTextInner(
    jid: string,
    text: string,
  ): Promise<{ externalMessageId: string }> {
    // Re-check readiness inside the lock. If a previous queued send
    // hit send_timeout, the socket is now stale and we should fail
    // fast rather than push a doomed sendMessage onto a dying ws.
    const readiness = this.getReadiness();
    if (!readiness.ok) {
      log.warn({ readiness }, 'sendText post-lock readiness failed');
      throw new Error('whatsapp_not_connected');
    }
    log.info(
      {
        ageMs: readiness.ageMs,
        wsState: readiness.wsState,
        lastUpdate: readiness.lastUpdate,
        lastDisconnectReason: readiness.lastDisconnectReason,
      },
      'sendText starting socket.sendMessage',
    );

    const SEND_TIMEOUT_MS = 12_000;
    let timer: NodeJS.Timeout | null = null;
    const sendPromise = this.socket!.sendMessage(jid, { text });
    // Suppress late rejection: if the race times out and the underlying
    // sendMessage eventually rejects (e.g. socket closed), the rejection
    // is irrelevant to this caller and otherwise becomes an uncaught
    // promise rejection.
    sendPromise.catch(() => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('send_timeout')), SEND_TIMEOUT_MS);
    });

    let result;
    try {
      result = await Promise.race([sendPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof Error && err.message === 'send_timeout') {
        log.error(
          { ageMs: readiness.ageMs, lastUpdate: readiness.lastUpdate },
          'sendText send_timeout — marking socket stale and triggering reconnect',
        );
        // Fire-and-forget: we want the 504 response to go out immediately.
        // markStaleAndReconnect is idempotent.
        void this.markStaleAndReconnect('send_timeout');
      }
      throw err;
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

    if (connection) {
      this.lastConnectionUpdate = connection;
    }

    if (connection === 'open') {
      this.attempt = 0;
      this.connected = true;
      this.staleReason = null;
      this.socketOpenedAt = new Date();
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
      this.socketOpenedAt = null;
      this.clearHealthyTimer();
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reason = describeReason(code);
      this.lastDisconnectReason = reason;

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

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0]?.slice(0, 240) ?? 'unknown';
  return String(err).slice(0, 240);
}
