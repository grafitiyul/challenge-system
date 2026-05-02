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
  fetchProfilePictureSafe,
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
  // socket-state snapshot. wsState is included in the snapshot for
  // debugging but does NOT gate readiness — Baileys' WASocket wraps
  // the underlying ws and `readyState` can read 'unknown' on an
  // otherwise-healthy socket; failing readiness on that produced the
  // observed flapping where the UI never settled on "ready" after a
  // QR scan.
  private socketOpenedAt: Date | null = null;
  private lastConnectionUpdate: 'open' | 'close' | 'connecting' | null = null;
  private lastDisconnectReason: string | null = null;
  // Set when this layer (e.g. send_timeout, admin restart) decided
  // the socket is unusable. Cleared on the next connection.update('open').
  private staleReason: string | null = null;
  // True while reopenSocket() is in flight, so concurrent sends or
  // repeated triggers don't pile up multiple socket-rebuild attempts.
  private reconnecting = false;

  // True while refreshMissingChatPictures is iterating. The route
  // returns 409 to a second caller landing during a run rather than
  // queueing — refresh is admin-driven + bounded; a backlog is the
  // operator's signal to wait, not an excuse to stack jobs.
  private refreshChatPicturesInFlight = false;

  // ── Single-socket lifecycle invariant ───────────────────────────
  // Bumped each time connect() spins up a new socket. Every event
  // handler captures its socketId at attach time and ignores the
  // event if it no longer matches activeSocketId — that's how we
  // prevent an old socket's late-firing `connection.update('close')`
  // (e.g. WhatsApp's connectionReplaced after we proactively opened a
  // new socket) from clobbering the freshly-created live socket.
  private activeSocketId = 0;
  // True for the duration of a reopen (teardown → new connect call).
  // Subsequent reopen requests during this window are coalesced into
  // a single no-op + log line, instead of stacking on the chain.
  private reopenInFlight = false;
  // Promise chain that serializes ALL connect/reopen work — so the
  // initial start, scheduleReconnect's delayed connect, restart-socket,
  // send_timeout recovery, and the restartRequired/connectionReplaced
  // close handlers cannot run concurrent connect()s.
  private reconnectChain: Promise<unknown> = Promise.resolve();

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
    // Lock-funnel the initial connect, same as scheduleReconnect and
    // reopenSocket, so an admin restart that lands during boot can't
    // run alongside the boot-time connect.
    await this.withReconnectLock(() => this.connect());
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
  // is usable. Returned as-is by /send and /status so a single log
  // line captures the exact state at attempt time. `reason` is null
  // when ok=true; otherwise a short tag pinpointing the failing check.
  //
  // Readiness checks (in priority order):
  //   reconnecting   — a reopen is in flight; sends MUST wait
  //   staleReason    — this layer marked the socket unusable
  //   !hasSocket     — no socket object yet (start / mid-reopen)
  //   !connected     — connection.update('open') not yet seen
  //   !hasUser       — handshake not yet complete (no JID assigned)
  //
  // wsState is NOT a gate. Baileys' WASocket wraps the underlying ws
  // and the wrapper's readyState can surface as 'unknown' on an
  // otherwise-healthy socket — failing readiness on that produced the
  // post-QR flapping. We keep wsState in the snapshot for diagnostics
  // (visible in /status diagnostic strip + /send logs) so an admin
  // can still see "ws=CLOSED" if it's a real problem, but it never
  // by itself flips ok=false.
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

  // Single entry point that EVERY reconnect path funnels through:
  //   - send_timeout recovery       (markStale=true)
  //   - admin /restart-socket       (markStale=true)
  //   - restartRequired close event (markStale=false — routine signal)
  //   - connectionReplaced fallback (markStale=true — defensive)
  //
  // Three layered guards prevent the rapid-flap behavior we saw after
  // QR scan:
  //   1. reopenInFlight — a second call during an in-flight reopen
  //      is a no-op + log line; events do not stack on the chain.
  //   2. reconnectChain — every connect() body still serializes,
  //      so an earlier scheduleReconnect's deferred connect cannot
  //      race a manual reopen that lands while the timer is firing.
  //   3. socketId in handlers — a late close event from the OLD
  //      socket (very common during connectionReplaced) is ignored
  //      via the ID check inside handleConnectionUpdate.
  private async reopenSocket(
    reason: string,
    opts: { markStale: boolean },
  ): Promise<void> {
    if (this.stopped) {
      log.warn({ reason }, 'reopen skipped: client stopped');
      return;
    }
    if (this.reopenInFlight) {
      log.info({ reason }, 'reopen skipped: another reopen already in progress');
      return;
    }
    this.reopenInFlight = true;
    try {
      await this.withReconnectLock(async () => {
        const oldSocketId = this.activeSocketId;
        this.reconnecting = true;
        this.connected = false;
        if (opts.markStale) this.staleReason = reason;
        const ageMs = this.socketOpenedAt
          ? Date.now() - this.socketOpenedAt.getTime()
          : null;
        log.warn(
          { reason, oldSocketId, ageMs, markStale: opts.markStale, lastUpdate: this.lastConnectionUpdate },
          'reopen requested',
        );

        // Detach OUR listeners from the old socket BEFORE end()ing
        // it, so the old socket's terminal close event can't run our
        // handler against the (about-to-be) live new socket. Belt
        // and suspenders alongside the activeSocketId guard.
        const old = this.socket;
        this.socket = null;
        this.socketOpenedAt = null;
        if (old) {
          // Detach OUR listeners by event name. Baileys' typed EE
          // doesn't accept removeAllListeners() without an event arg,
          // so we list the four channels we attached in connect().
          // The activeSocketId guard inside each handler is the
          // primary defense; this is belt-and-suspenders so the old
          // socket's emitter stops dispatching to our closures even
          // before end() tears it down.
          try {
            old.ev.removeAllListeners('connection.update');
            old.ev.removeAllListeners('creds.update');
            old.ev.removeAllListeners('messages.upsert');
            old.ev.removeAllListeners('messages.reaction');
            old.ev.removeAllListeners('messaging-history.set');
          } catch { /* ignore — old socket already torn down */ }
          try {
            old.end(new Error(`bridge_force_reopen:${reason}`));
            log.info({ oldSocketId, reason }, 'old socket closed');
          } catch (err) {
            log.warn(
              { err: errMessage(err), oldSocketId },
              'old socket end() threw; proceeding with reopen',
            );
          }
        }

        if (opts.markStale) {
          await connState.setDisconnected(prisma, `stale_socket:${reason}`, {
            incrementAttempts: false,
          });
        }

        // Reset backoff so we connect immediately rather than waiting
        // on the previous attempt counter.
        this.attempt = 0;
        this.clearTimers();

        try {
          await this.connect();
          log.info(
            { reason, newSocketId: this.activeSocketId },
            'reopen connect() returned (awaiting connection.update open)',
          );
        } catch (err) {
          log.error(
            { err: errMessage(err), reason },
            'reopen connect() failed; falling back to scheduled backoff',
          );
          this.scheduleReconnect();
        }
        // reconnecting flag is cleared by connection.update('open'),
        // not here — so a pending send doesn't see ok=true in the
        // window between connect() returning and the open event.
      });
    } finally {
      this.reopenInFlight = false;
    }
  }

  // Public alias kept so existing callers (HTTP /send timeout path)
  // and external code keep working. Always marks the socket stale.
  async markStaleAndReconnect(reason: string): Promise<void> {
    return this.reopenSocket(reason, { markStale: true });
  }

  // Admin-triggered restart. Surfaces in audit logs as 'admin_restart'
  // and marks the socket stale so the readiness pill flips to a
  // visible state during the rebuild.
  async restartSocket(): Promise<void> {
    log.warn('admin restart-socket requested');
    await this.reopenSocket('admin_restart', { markStale: true });
  }

  // Admin-triggered HARD RESET. Materially different from restartSocket
  // and signOut:
  //
  //   restartSocket — keeps the persisted Baileys auth (creds + signal
  //                   keys); just rebuilds the live socket. Use when
  //                   the socket is wedged but the session is healthy.
  //
  //   signOut       — calls socket.logout() (talks to WhatsApp servers
  //                   to revoke the linked-device slot), THEN wipes
  //                   creds, THEN sets stopped=true. Good UX when the
  //                   session is healthy and you want a clean unlink.
  //                   But socket.logout() has no timeout and routinely
  //                   hangs against a broken session — exactly when we
  //                   need a wipe path the most.
  //
  //   hardResetSession — what this method does. NO logout call. NO
  //                   "stopped" flag. Tear the socket down locally,
  //                   delete every row in whatsapp_sessions, reset the
  //                   WhatsAppConnection singleton to a fresh-pair
  //                   state, immediately open a new socket which will
  //                   emit a fresh QR.
  //
  // Funnels through the same withReconnectLock + reopenInFlight guards
  // as the rest of the lifecycle so it serializes cleanly with any
  // ongoing reopen / scheduleReconnect.
  async hardResetSession(): Promise<void> {
    log.warn('hard-reset-session requested');
    if (this.stopped) {
      log.warn('hard-reset deferred: client.stopped=true; un-stopping for the reset');
      this.stopped = false;
    }
    return this.withReconnectLock(async () => {
      this.reopenInFlight = true;
      try {
        const oldSocketId = this.activeSocketId;
        this.reconnecting = true;
        this.connected = false;
        // Tag staleReason so getReadiness reports a clean recovery
        // signal during the brief gap between the wipe and the new
        // QR; cleared on the next connection.update('open') (or on
        // qr_required, which is the next state after the wipe).
        this.staleReason = 'hard_reset';
        this.lastDisconnectReason = null;
        log.warn({ oldSocketId }, 'hard-reset: tearing down current socket (no logout call)');

        // Detach our listeners + end the socket. Crucially, we do NOT
        // call socket.logout() — that's the bit that hangs on a
        // broken session and is the reason we need this command at all.
        const old = this.socket;
        this.socket = null;
        this.socketOpenedAt = null;
        if (old) {
          try {
            old.ev.removeAllListeners('connection.update');
            old.ev.removeAllListeners('creds.update');
            old.ev.removeAllListeners('messages.upsert');
            old.ev.removeAllListeners('messages.reaction');
            old.ev.removeAllListeners('messaging-history.set');
          } catch { /* ignore */ }
          try {
            old.end(new Error('bridge_hard_reset'));
            log.info({ oldSocketId }, 'hard-reset: old socket closed');
          } catch (err) {
            log.warn(
              { err: errMessage(err), oldSocketId },
              'hard-reset: old socket end() threw; proceeding',
            );
          }
        }

        // Wipe persisted auth — creds + every signal key in the
        // whatsapp_sessions table. If the auth handle isn't loaded yet
        // (e.g., bridge was mid-boot), open a transient one just to
        // perform the wipe.
        try {
          if (this.auth) {
            await this.auth.clear();
          } else {
            const handle = await makePostgresAuthState(prisma);
            await handle.clear();
          }
          log.warn('hard-reset: persisted auth state wiped');
        } catch (err) {
          log.error(
            { err: errMessage(err) },
            'hard-reset: auth.clear() failed; continuing — corrupt rows will be overwritten by fresh pair',
          );
        }
        this.auth = null;

        // Reset the WhatsAppConnection singleton so the admin UI shows
        // a clean fresh-pair state rather than stale connected/JID.
        // Keep the row (id='singleton' is referenced everywhere) but
        // null out every transient field. lastConnectedAt /
        // lastDisconnectAt are also cleared because after a hard reset
        // the prior history is no longer this device's history.
        try {
          await prisma.whatsAppConnection.upsert({
            where: { id: 'singleton' },
            create: {
              id: 'singleton', status: 'disconnected', qr: null,
              phoneJid: null, deviceName: null,
              lastQrAt: null, lastConnectedAt: null, lastDisconnectAt: null,
              lastDisconnectReason: 'hard_reset', reconnectAttempts: 0,
            },
            update: {
              status: 'disconnected', qr: null,
              phoneJid: null, deviceName: null,
              lastQrAt: null, lastConnectedAt: null, lastDisconnectAt: null,
              lastDisconnectReason: 'hard_reset', reconnectAttempts: 0,
            },
          });
          log.warn('hard-reset: WhatsAppConnection singleton reset');
        } catch (err) {
          log.error(
            { err: errMessage(err) },
            'hard-reset: WhatsAppConnection reset failed; continuing — connect() will reset on its own',
          );
        }

        // Reset in-memory backoff/timer state. clearTimers also kills
        // any pending healthy/reconnect timers from the dead socket.
        this.attempt = 0;
        this.clearTimers();

        // Spin up a fresh socket. With auth wiped, Baileys will emit
        // a fresh QR within ~1s; the existing connection.update
        // handler persists it via connState.setQrRequired and the
        // admin UI's poll picks it up.
        try {
          await this.connect();
          log.info(
            { newSocketId: this.activeSocketId },
            'hard-reset: connect() returned (awaiting QR)',
          );
        } catch (err) {
          log.error(
            { err: errMessage(err) },
            'hard-reset: connect() failed; falling back to scheduled backoff',
          );
          this.scheduleReconnect();
        }
      } finally {
        this.reopenInFlight = false;
      }
    });
  }

  // Serialize ALL connect/reopen work through a single Promise chain.
  // Errors are swallowed at the chain boundary so one failed reopen
  // doesn't poison the queue for subsequent calls.
  private withReconnectLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.reconnectChain.then(fn, fn);
    this.reconnectChain = next.catch(() => undefined);
    return next;
  }

  // Backstop for chats that existed before the profilePictureUrl
  // capture hook was added (or where the first-ingest fetch returned
  // null — restrictive privacy, transient WhatsApp error). Iterates
  // chats with NULL profilePictureUrl and tries again, capped per
  // call + paced between fetches so we don't swamp WhatsApp's
  // protocol channel or block normal ingest.
  //
  // Concurrency: refuses overlap via refreshChatPicturesInFlight so a
  // second admin click while one run is going returns alreadyRunning
  // rather than stacking work. The flag is process-local; the bridge
  // is replicas=1 anyway (see README) so this is the only guard
  // needed.
  //
  // Rate budget: at maxRows=50 + delayMsBetween=1500 the worst-case
  // wall-clock is ~75s — comfortably inside the API proxy's 120s
  // timeout, and well under WhatsApp's spam thresholds for
  // non-message protocol queries.
  async refreshMissingChatPictures(opts: {
    maxRows?: number;
    delayMsBetween?: number;
  } = {}): Promise<{
    checked: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: string[];
    alreadyRunning?: boolean;
    notReady?: boolean;
    notReadyReason?: string;
  }> {
    if (this.refreshChatPicturesInFlight) {
      return { checked: 0, updated: 0, skipped: 0, failed: 0, errors: [], alreadyRunning: true };
    }
    const readiness = this.getReadiness();
    if (!readiness.ok) {
      return {
        checked: 0, updated: 0, skipped: 0, failed: 0, errors: [],
        notReady: true, notReadyReason: readiness.reason ?? 'not_ready',
      };
    }
    const maxRows = Math.max(1, Math.min(opts.maxRows ?? 50, 200));
    const delayMs = Math.max(0, opts.delayMsBetween ?? 1500);

    this.refreshChatPicturesInFlight = true;
    const startedAt = Date.now();
    try {
      // Order by lastMessageAt desc so the most-recently-active chats
      // get refreshed first — that's what the admin sees in their
      // link-chat modal anyway. Older / abandoned chats wait.
      const candidates = await prisma.whatsAppChat.findMany({
        where: { profilePictureUrl: null },
        orderBy: { lastMessageAt: 'desc' },
        take: maxRows,
        select: { id: true, externalChatId: true },
      });
      log.info({ count: candidates.length, maxRows }, 'refresh-chat-pictures starting');

      let checked = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        checked++;
        try {
          const url = await fetchProfilePictureSafe(this.socket!, c.externalChatId, log);
          if (url) {
            // Defensive WHERE clause: another path (a fresh inbound
            // upsert, the future bridge restart) might have already
            // set the URL between SELECT and UPDATE. Updating only
            // when still null avoids stomping on a fresher capture.
            const result = await prisma.whatsAppChat.updateMany({
              where: { id: c.id, profilePictureUrl: null },
              data: { profilePictureUrl: url },
            });
            if (result.count > 0) updated++;
            else skipped++;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          // Cap the error list — admins don't need 50 lines of
          // similar failure reasons. Ten samples is enough to triage.
          if (errors.length < 10) {
            errors.push(err instanceof Error ? err.message.split('\n')[0]?.slice(0, 200) ?? 'unknown' : 'unknown');
          }
        }
        // Pacing — skip after the last item.
        if (i < candidates.length - 1 && delayMs > 0) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }

      log.info(
        { checked, updated, skipped, failed, elapsedMs: Date.now() - startedAt },
        'refresh-chat-pictures complete',
      );
      return { checked, updated, skipped, failed, errors };
    } finally {
      this.refreshChatPicturesInFlight = false;
    }
  }

  // Probe whether a JID is registered on WhatsApp via socket.onWhatsApp.
  // Wraps the call in our own timeout so a hung protocol query (the
  // common failure mode behind send_timeout — Baileys' sendMessage
  // waits for an ACK over the same channel) surfaces as a distinct
  // 'on_whatsapp_timeout' code instead of looking like a generic
  // sendMessage hang. Group JIDs are skipped because @g.us isn't a
  // member-resolvable target — onWhatsApp only validates personal
  // numbers; we treat groups as "registered" so the gate passes
  // through to sendMessage.
  //
  // Returned shape:
  //   { registered: true,  resolvedJid: '<canonical jid>' } — number is on WA
  //   { registered: false, resolvedJid: null              } — confirmed not on WA
  //   throws Error('on_whatsapp_timeout') — query did not return in 6s
  //   throws Error('on_whatsapp_failed')  — Baileys threw (auth issue, etc.)
  async checkOnWhatsApp(jid: string): Promise<{ registered: boolean; resolvedJid: string | null }> {
    if (!this.socket) throw new Error('whatsapp_not_connected');
    if (jid.endsWith('@g.us')) {
      return { registered: true, resolvedJid: jid };
    }
    const ON_WA_TIMEOUT_MS = 6_000;
    let timer: NodeJS.Timeout | null = null;
    const probe = this.socket.onWhatsApp(jid);
    // Suppress late rejection of the probe so a post-timeout failure
    // doesn't bubble up as an unhandled rejection.
    probe.catch(() => undefined);
    try {
      const result = await Promise.race([
        probe,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('on_whatsapp_timeout')), ON_WA_TIMEOUT_MS);
        }),
      ]);
      const first = Array.isArray(result) ? result[0] : null;
      const exists = !!first?.exists;
      const resolved = (first as { jid?: string } | null)?.jid ?? null;
      return { registered: exists, resolvedJid: resolved };
    } catch (err) {
      if (err instanceof Error && err.message === 'on_whatsapp_timeout') throw err;
      // Anything else from Baileys is wrapped so the HTTP layer can
      // distinguish "query timed out" from "Baileys threw".
      throw new Error('on_whatsapp_failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
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
        userJid: this.socket?.user?.id ?? null,
      },
      'sendText: pre-flight ok',
    );

    // ── onWhatsApp gate (private JIDs only) ─────────────────────────
    // The single highest-leverage diagnostic for the "send_timeout
    // even on a fresh paired session" pattern: distinguish "this
    // number is not on WhatsApp" / "the protocol can't even resolve
    // a query" from "sendMessage itself hangs". onWhatsApp uses the
    // same Noise channel as sendMessage; if it can't return in 6s,
    // the channel is unhealthy and sendMessage would hang anyway.
    const onWaStart = Date.now();
    let onWa: { registered: boolean; resolvedJid: string | null };
    try {
      onWa = await this.checkOnWhatsApp(jid);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'on_whatsapp_failed';
      log.error(
        { jid, code, elapsedMs: Date.now() - onWaStart },
        'sendText: onWhatsApp failed',
      );
      // The protocol query died; the socket is effectively unusable
      // for sends. Trigger a reconnect so the next attempt either
      // succeeds on a healthy socket or fails fast on readiness.
      if (code === 'on_whatsapp_timeout') {
        void this.markStaleAndReconnect('on_whatsapp_timeout');
      }
      throw new Error(code);
    }
    log.info(
      {
        jid, registered: onWa.registered, resolvedJid: onWa.resolvedJid,
        elapsedMs: Date.now() - onWaStart,
      },
      'sendText: onWhatsApp result',
    );
    if (!onWa.registered) {
      // Number genuinely isn't on WhatsApp. Caller maps to 404
      // (whatsapp_number_not_found). Never call sendMessage in this
      // branch — Baileys' sendMessage to a non-WA JID is one of the
      // observed timeout sources.
      throw new Error('whatsapp_number_not_found');
    }
    const targetJid = onWa.resolvedJid ?? jid;

    // ── sendMessage (with timing + late-rejection suppression) ──────
    const SEND_TIMEOUT_MS = 12_000;
    const sendStart = Date.now();
    log.info({ targetJid, len: text.length }, 'sendText: socket.sendMessage starting');

    let timer: NodeJS.Timeout | null = null;
    const sendPromise = this.socket!.sendMessage(targetJid, { text });
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
      log.info(
        { targetJid, elapsedMs: Date.now() - sendStart, hasKey: !!result?.key, hasId: !!result?.key?.id },
        'sendText: socket.sendMessage returned',
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'send_timeout') {
        log.error(
          {
            targetJid,
            elapsedMs: Date.now() - sendStart,
            ageMs: readiness.ageMs,
            lastUpdate: readiness.lastUpdate,
          },
          'sendText: socket.sendMessage TIMEOUT — marking socket stale and triggering reconnect',
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
    // Single-socket invariant: refuse to overwrite an existing live
    // socket. If one is alive and we're being asked to connect again,
    // the right path is reopenSocket() (which tears the old one down
    // first under the mutex). Bailing here protects against a race
    // where two reconnect timers fire back-to-back.
    if (this.socket) {
      log.warn(
        { activeSocketId: this.activeSocketId },
        'connect() called with an existing socket; refusing to overwrite',
      );
      return;
    }

    // New socket lifecycle starts here. socketId is captured by every
    // event-handler closure below so a late event from this socket
    // (after a future reopen) can be ignored via the activeSocketId
    // check inside handleConnectionUpdate.
    const socketId = ++this.activeSocketId;

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
      // Required for production reliability of socket.sendMessage.
      // When the recipient device hasn't seen our pre-key bundle yet
      // (typical on first-send-to-a-new-recipient), WhatsApp asks
      // Baileys to retransmit the message; Baileys looks up the
      // original payload via this callback. Without it, the retry
      // path silently stalls and the originating sendMessage()
      // promise never resolves — that's the exact "send_timeout
      // even though onWhatsApp succeeded" pattern we were hitting.
      // Returning undefined tells Baileys we don't have a stored
      // copy; it then drops the retry rather than waiting forever.
      // We don't currently persist outbound payloads keyed by
      // message id, so undefined is the only honest answer; a
      // future improvement could look the row up in
      // WhatsAppMessage by externalMessageId, but that's a separate
      // change.
      getMessage: async () => {
        return undefined;
      },
    });
    this.socket = socket;
    log.info({ socketId }, 'socket created');

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

    // Stale-handler guard: every event handler captures `socketId` at
    // attach time and is a no-op for events from sockets that have
    // since been replaced (activeSocketId moved on). This is what
    // prevents a delayed close event from the OLD socket — common
    // during connectionReplaced / restartRequired — from running our
    // close-bookkeeping against the freshly-opened LIVE socket.
    socket.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(socketId, update);
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

    // Same socketId guard as connection.update — stale message events
    // from a replaced socket are silently dropped. Without this, the
    // ingest path keeps writing through old socket references after a
    // reopen, producing duplicate inbound rows or stale media reads.
    socket.ev.on('messages.upsert', (payload) => {
      if (socketId !== this.activeSocketId) return;
      void handleMessagesUpsert(ingestServices, payload);
    });
    socket.ev.on('messages.reaction', (reactions) => {
      if (socketId !== this.activeSocketId) return;
      void handleReactions(ingestServices, reactions);
    });
    socket.ev.on('messaging-history.set', (history) => {
      if (socketId !== this.activeSocketId) return;
      void handleHistorySync(ingestServices, history);
    });

    log.info({ socketId, mediaStorage: this.storage.kind }, 'message handlers wired');
  }

  private async handleConnectionUpdate(
    socketId: number,
    update: Partial<ConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    // Stale-handler guard. Every event handler captured `socketId` at
    // attach time (see connect() above). If the active socket has
    // moved on since then, this event is from a torn-down socket and
    // we MUST NOT touch any shared state — doing so was the bug that
    // produced the post-QR flapping (an old socket's late close event
    // would call setDisconnected / scheduleReconnect against the
    // freshly-opened live socket, and the cycle continued).
    if (socketId !== this.activeSocketId) {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      log.info(
        {
          socketId,
          activeSocketId: this.activeSocketId,
          connection,
          disconnectReason: code !== undefined ? describeReason(code) : null,
        },
        'connection.update from stale socket; ignoring',
      );
      return;
    }

    // Structured raw log of every connection.update — captures the
    // exact statusCode + Boom error shape that's driving our branch
    // selection below. No credential content is logged. This is what
    // we read when "the bridge says loggedOut but I didn't unlink".
    if (connection || lastDisconnect || qr) {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const errMsg = lastDisconnect?.error?.message;
      log.info(
        {
          socketId,
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
      log.info({ socketId }, 'qr code emitted; waiting for scan');
      await connState.setQrRequired(prisma, qr);
    }

    if (connection) {
      this.lastConnectionUpdate = connection;
    }

    if (connection === 'open') {
      this.attempt = 0;
      this.connected = true;
      this.staleReason = null;
      this.reconnecting = false;
      this.socketOpenedAt = new Date();
      // Clear transient close reasons that are noise after a clean
      // reopen. Both restartRequired (515) and connectionReplaced (440)
      // are protocol-level "rebuild the socket" signals — once we're
      // open again on the new socket, leaving them in
      // lastDisconnectReason makes the admin UI permanently say
      // "סיבת ניתוק: restartRequired" on a perfectly healthy bridge.
      if (
        this.lastDisconnectReason === 'restartRequired' ||
        this.lastDisconnectReason === 'connectionReplaced'
      ) {
        this.lastDisconnectReason = null;
      }
      const me = this.socket?.user;
      log.info({ socketId, jid: me?.id, name: me?.name }, 'connected');
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
          { socketId, code, reason },
          'connection closed (loggedOut) — keeping creds; admin must click Sign out to wipe + re-pair',
        );
        this.socket = null;
        await connState.setDisconnected(prisma, reason, {
          incrementAttempts: false,
        });
        return;
      }

      // restartRequired (515): WhatsApp's "rebuild the socket" signal,
      // emitted right after pairing and occasionally mid-session.
      // Routes through the unified reopen path so it serializes with
      // every other reconnect trigger (admin restart, send_timeout) —
      // before this fix, an old-socket restartRequired could fire
      // while a new socket was already opening and clobber it.
      if (code === DisconnectReason.restartRequired) {
        log.info(
          { socketId, code },
          'restartRequired — funnelling through reopenSocket (routine post-handshake signal)',
        );
        // markStale=false: this isn't a fault, just a protocol signal,
        // so the admin UI shouldn't briefly show a red "stale" pill
        // during the rebuild — just "reconnecting".
        void this.reopenSocket('restartRequired', { markStale: false });
        return;
      }

      // connectionReplaced (440): WhatsApp kicked us because another
      // session linked. In the common case we caused it ourselves by
      // opening a new socket while the old one's TCP was still alive
      // — that situation is fully handled by the activeSocketId guard
      // above (the close fires from the OLD socket which is no longer
      // active, so we never reach this branch). If we DO reach it, an
      // outside session connected; reopen and let WhatsApp arbitrate.
      // markStale=true so the admin sees the visible recovery state.
      if (code === DisconnectReason.connectionReplaced) {
        log.warn(
          { socketId, code },
          'connectionReplaced on the active socket — funnelling through reopenSocket',
        );
        void this.reopenSocket('connectionReplaced', { markStale: true });
        return;
      }

      // Anything else (timedOut, connectionLost, generic close): this
      // is the passive backoff path. Don't reopen aggressively — let
      // scheduleReconnect's exponential backoff handle it.
      log.warn({ socketId, code, reason }, 'connection closed; scheduling reconnect');
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
      // Funnel through the same reconnect lock as reopenSocket so a
      // delayed scheduled connect can't race a manual reopen that
      // lands while this timer is firing. The lock plus the
      // single-socket invariant in connect() (refuses to overwrite
      // an existing socket) prevent the dual-socket state that was
      // producing connectionReplaced loops.
      void this.withReconnectLock(() => this.connect()).catch((err) => {
        log.error({ err: errMessage(err) }, 'scheduled reconnect failed; rescheduling');
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
