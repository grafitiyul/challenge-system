// Thin proxy from the API to the WhatsApp bridge service. The admin
// UI never talks to the bridge directly — it goes through these
// admin-guarded routes which forward to the bridge's internal HTTP
// server using the shared INTERNAL_API_SECRET.
//
// Endpoints:
//   - GET  /api/admin/whatsapp/status   → bridge GET  /status
//   - POST /api/admin/whatsapp/sign-out → bridge POST /sign-out
//   - sendMessage()                     → bridge POST /send
//
// sendMessage is exposed as a service method (not just an HTTP route)
// because participant + group send flows want to call it from inside
// other services without going through HTTP.
//
// If the bridge URL is missing or the bridge is offline, every endpoint
// returns a typed "bridge_unavailable" payload so the admin UI can
// distinguish "the bridge is disconnected from WhatsApp" from "the
// bridge process is itself down".

import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

// Live readiness snapshot from the bridge. Mirrors the
// ReadinessSnapshot interface in apps/whatsapp-bridge/src/baileys/client.ts.
// Surfaced through /status so the admin UI's "connected" indicator is
// driven by the same source-of-truth that /send uses, not by a stale
// persisted state.
export interface BridgeReadiness {
  ok: boolean;
  reason: string | null;
  hasSocket: boolean;
  connected: boolean;
  hasUser: boolean;
  wsState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'unknown';
  ageMs: number | null;
  lastUpdate: 'open' | 'close' | 'connecting' | null;
  lastDisconnectReason: string | null;
  staleReason: string | null;
  reconnecting: boolean;
}

export interface BridgeStatusPayload {
  status: 'disconnected' | 'qr_required' | 'pairing' | 'connecting' | 'connected';
  qr: string | null;
  qrDataUrl: string | null;
  phoneJid: string | null;
  deviceName: string | null;
  lastQrAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  lastMessageAt: string | null;
  reconnectAttempts: number;
  // Phase 2 — message + media metrics for the admin status card.
  lastMediaError: string | null;
  lastMediaErrorAt: string | null;
  messagesToday: number;
  mediaToday: number;
  // Live socket-readiness from the bridge. Optional only because a
  // pre-deploy bridge build might not include it; new code paths
  // require its presence and treat absence as "ready unknown".
  readiness?: BridgeReadiness;
}

// Accept both env-var name pairs:
//   WHATSAPP_BRIDGE_URL + INTERNAL_API_SECRET   (Phase 1 names; in
//                                                production today)
//   BAILEYS_BRIDGE_URL  + BAILEYS_BRIDGE_SECRET (Phase 3 spec names)
// First non-empty wins. This avoids a config-rename race where the
// operator follows the Phase 3 doc literally and sets the *_BRIDGE_*
// names but the API was still reading WHATSAPP_BRIDGE_URL — silently
// failing with "שירות WhatsApp לא מוגדר".
function bridgeUrl(): string | null {
  const v = process.env['WHATSAPP_BRIDGE_URL'] ?? process.env['BAILEYS_BRIDGE_URL'];
  if (!v || !v.trim()) return null;
  return v.trim().replace(/\/+$/, '');
}

function bridgeSecret(): string {
  const v = process.env['INTERNAL_API_SECRET'] ?? process.env['BAILEYS_BRIDGE_SECRET'];
  if (!v) {
    throw new ServiceUnavailableException('INTERNAL_API_SECRET / BAILEYS_BRIDGE_SECRET not configured');
  }
  return v;
}

@Injectable()
export class WhatsappBridgeService {
  async getStatus(): Promise<BridgeStatusPayload | { bridgeUnavailable: true; reason: string }> {
    const base = bridgeUrl();
    if (!base) return { bridgeUnavailable: true, reason: 'WHATSAPP_BRIDGE_URL not configured' };
    try {
      const res = await fetch(`${base}/status`, {
        headers: { Authorization: `Bearer ${bridgeSecret()}` },
        // Short timeout: the bridge is on Railway's private network,
        // anything > 3s means it's actually down.
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return { bridgeUnavailable: true, reason: `bridge returned ${res.status}` };
      }
      return (await res.json()) as BridgeStatusPayload;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { bridgeUnavailable: true, reason: message };
    }
  }

  // Outbound send via the bridge. Throws ServiceUnavailable when the
  // bridge URL isn't configured or the bridge is unreachable. Throws
  // BadRequest with a Hebrew message when WhatsApp is not currently
  // connected (so the admin UI can render the "WhatsApp לא מחובר
  // כרגע" toast). Returns the WhatsApp-assigned externalMessageId on
  // success — callers don't strictly need it (the bridge persists the
  // outbound row itself) but it's useful for logs / reconciliation.
  async sendMessage(phoneOrJid: string, message: string): Promise<{ ok: true; externalMessageId: string }> {
    const base = bridgeUrl();
    if (!base) {
      // eslint-disable-next-line no-console
      console.warn('[whatsapp-send] bridge URL not configured (checked WHATSAPP_BRIDGE_URL + BAILEYS_BRIDGE_URL)');
      throw new ServiceUnavailableException('שירות WhatsApp לא מוגדר. פנה למנהל המערכת.');
    }
    // Log attempts so the next failure leaves a trail in Railway logs.
    // Phone is partially redacted (last 4 digits + jid suffix only) per
    // the strict "no message contents in logs" policy.
    const jidShape = phoneOrJid.endsWith('@g.us') ? 'group'
      : phoneOrJid.endsWith('@s.whatsapp.net') ? 'private'
      : 'phone';
    const phoneTail = phoneOrJid.replace(/\D/g, '').slice(-4);
    // eslint-disable-next-line no-console
    console.log('[whatsapp-send] attempt base=%s jidShape=%s phoneTail=%s len=%d',
      base, jidShape, phoneTail, message.length);

    let res: Response;
    try {
      res = await fetch(`${base}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bridgeSecret()}`,
        },
        body: JSON.stringify({ phone: phoneOrJid, message }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      // eslint-disable-next-line no-console
      console.error('[whatsapp-send] bridge unreachable base=%s reason=%s', base, reason);
      throw new ServiceUnavailableException(`גשר WhatsApp לא זמין (${reason}).`);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { externalMessageId?: string };
      if (!json.externalMessageId) {
        // eslint-disable-next-line no-console
        console.warn('[whatsapp-send] bridge returned 200 without externalMessageId');
        throw new ServiceUnavailableException('הגשר החזיר תגובה ללא מזהה הודעה.');
      }
      // eslint-disable-next-line no-console
      console.log('[whatsapp-send] ok externalMessageId=%s', json.externalMessageId);
      return { ok: true, externalMessageId: json.externalMessageId };
    }

    // Map bridge response codes to distinct exceptions / Hebrew
    // messages. Each branch corresponds to one of the bridge's named
    // failure modes (bridge_auth_failed / invalid_payload /
    // whatsapp_not_connected / send_timeout / send_failed). Generic
    // fallbacks at the bottom catch anything outside this contract
    // — they shouldn't fire in production but exist so a future
    // bridge change doesn't crash the proxy.
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
      detail?: string;
      reconnect_started?: boolean;
    };
    // eslint-disable-next-line no-console
    console.warn('[whatsapp-send] bridge non-2xx status=%d error=%s reason=%s detail=%s reconnect_started=%s',
      res.status, body.error ?? '<none>', body.reason ?? '<none>', body.detail ?? '<none>', body.reconnect_started ?? false);

    if (res.status === 401 && body.error === 'bridge_auth_failed') {
      throw new ServiceUnavailableException(
        'הגשר דחה את הבקשה (סוד שירות לא תואם). ודאי ש-INTERNAL_API_SECRET / BAILEYS_BRIDGE_SECRET זהה ב-API ובגשר.',
      );
    }
    if (res.status === 503 && body.error === 'whatsapp_not_connected') {
      // body.reason is the bridge's readiness tag (e.g. 'reconnecting',
      // 'stale:send_timeout', 'ws_CLOSED'). Surface a different message
      // when a reconnect is already running so the admin doesn't think
      // they need to scan a fresh QR.
      if (body.reason === 'reconnecting' || (body.reason ?? '').startsWith('stale:')) {
        throw new ServiceUnavailableException(
          'חיבור WhatsApp מתחדש כעת (הסוקט היה תקוע). נסי שוב בעוד מספר שניות.',
        );
      }
      throw new ServiceUnavailableException('WhatsApp לא מחובר כרגע. פתחי את "מצב חיבור" וסרקי קוד QR.');
    }
    if (res.status === 504 && body.error === 'send_timeout') {
      // The bridge already kicked off a reconnect when the timeout
      // fired (reconnect_started=true). Tell the admin so the next
      // retry attempt hits a fresh socket instead of re-hitting the
      // same dead one.
      const tail = body.reconnect_started
        ? ' החיבור היה תקוע — מתחבר מחדש אוטומטית. נסי שוב בעוד מספר שניות.'
        : ' ייתכן שהסוקט תקוע — בדקי את "מצב חיבור" ונסי שוב.';
      throw new ServiceUnavailableException(
        `שליחה ל-WhatsApp לא הסתיימה בזמן (timeout בגשר).${tail}`,
      );
    }
    if (res.status === 404 && body.error === 'whatsapp_number_not_found') {
      // Pre-send onWhatsApp probe confirmed the number is not on
      // WhatsApp. Distinct from "send timed out" — the admin needs
      // to verify the number, not the connection.
      throw new BadRequestException('המספר אינו רשום ב-WhatsApp.');
    }
    if (res.status === 504 && body.error === 'on_whatsapp_timeout') {
      // The protocol-level query before sendMessage hung — the
      // socket is "open" but its Noise channel can't even resolve
      // a contact lookup. Different from sendMessage hanging.
      const tail = body.reconnect_started
        ? ' החיבור מתחדש אוטומטית. נסי שוב בעוד מספר שניות.'
        : '';
      throw new ServiceUnavailableException(
        `בדיקת חברות ה-WhatsApp לא הסתיימה בזמן (הסוקט פתוח אבל לא מגיב).${tail}`,
      );
    }
    if (res.status === 504 && body.error === 'on_whatsapp_failed') {
      throw new ServiceUnavailableException(
        'בדיקת חברות ה-WhatsApp נכשלה (Baileys זרק). נסי איפוס מלא וסריקת QR מחדש.',
      );
    }
    if (res.status === 500 && body.error === 'send_failed') {
      // body.detail is the safe single-line error message from the
      // bridge; never the raw stack.
      throw new ServiceUnavailableException(
        `שליחה נכשלה: ${body.detail ?? 'שגיאה לא ידועה'}.`,
      );
    }
    if (res.status === 400 && body.error === 'invalid_payload') {
      if (body.reason === 'phone_invalid') {
        throw new BadRequestException('מספר טלפון לא תקין.');
      }
      if (body.reason === 'phone_required' || body.reason === 'message_required') {
        throw new BadRequestException('מספר טלפון והודעה הם שדות חובה.');
      }
      throw new BadRequestException(`קלט לא תקין (${body.reason ?? '?'}).`);
    }

    // Generic fallbacks. Auth failures with the OLD error code, or any
    // unmapped status, end up here so the admin UI doesn't render an
    // empty toast.
    if (res.status === 401 || res.status === 403) {
      throw new ServiceUnavailableException(
        'הגשר דחה את הבקשה (סוד שירות לא תואם).',
      );
    }
    throw new ServiceUnavailableException(
      `שליחה דרך הגשר נכשלה (${res.status}${body.detail ? `: ${body.detail}` : ''}).`,
    );
  }

  // Forwards POST /api/admin/whatsapp/restart-socket to the bridge.
  // Bridge replies 202 immediately (the actual reconnect runs async)
  // with the readiness snapshot at request time so the admin UI can
  // render "reconnecting…" without polling /status separately.
  async restartSocket(): Promise<
    | { ok: true; restart_started: true; readiness: unknown }
    | { bridgeUnavailable: true; reason: string }
  > {
    const base = bridgeUrl();
    if (!base) return { bridgeUnavailable: true, reason: 'WHATSAPP_BRIDGE_URL not configured' };
    try {
      const res = await fetch(`${base}/restart-socket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridgeSecret()}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { bridgeUnavailable: true, reason: `bridge returned ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        restart_started?: boolean;
        readiness?: unknown;
      };
      return { ok: true, restart_started: true, readiness: json.readiness ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { bridgeUnavailable: true, reason: message };
    }
  }

  // POST /api/admin/whatsapp/debug-send → bridge POST /debug-send.
  // Diagnostic: runs the per-step send pipeline (normalize → readiness
  // → onWhatsApp → sendMessage) and returns step-by-step timings.
  // Bypasses the regular sendChain lock and never triggers reconnect,
  // so the response is pure observation. Use to pinpoint exactly
  // where send_timeout fires.
  async debugSend(phone: string, message?: string): Promise<unknown> {
    const base = bridgeUrl();
    if (!base) return { bridgeUnavailable: true, reason: 'WHATSAPP_BRIDGE_URL not configured' };
    try {
      const res = await fetch(`${base}/debug-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bridgeSecret()}`,
        },
        body: JSON.stringify({ phone, message }),
        // Generous: each internal step has its own 6–12s timeout, so
        // worst-case the bridge response back to us is ~25s. Longer
        // than the regular send timeout because /debug-send is a
        // human-driven diagnostic, not an end-user operation.
        signal: AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => ({}));
      // Pass through whatever the bridge returned; the bridge already
      // shapes the response as { ok, failedAt, steps, ... }.
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { bridgeUnavailable: true, reason: message };
    }
  }

  // POST /api/admin/whatsapp/hard-reset-session → bridge POST
  // /hard-reset-session. Wipes persisted Baileys auth + resets the
  // WhatsAppConnection singleton + spawns a fresh socket so a new
  // QR appears. Different from signOut (which tries to talk to
  // WhatsApp servers and hangs when the session is broken — the
  // exact case where this command is needed).
  async hardResetSession(): Promise<
    | { ok: true; hard_reset_started: true; readiness: unknown }
    | { bridgeUnavailable: true; reason: string }
  > {
    const base = bridgeUrl();
    if (!base) return { bridgeUnavailable: true, reason: 'WHATSAPP_BRIDGE_URL not configured' };
    try {
      const res = await fetch(`${base}/hard-reset-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridgeSecret()}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { bridgeUnavailable: true, reason: `bridge returned ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        hard_reset_started?: boolean;
        readiness?: unknown;
      };
      return { ok: true, hard_reset_started: true, readiness: json.readiness ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { bridgeUnavailable: true, reason: message };
    }
  }

  async signOut(): Promise<{ ok: true } | { bridgeUnavailable: true; reason: string }> {
    const base = bridgeUrl();
    if (!base) return { bridgeUnavailable: true, reason: 'WHATSAPP_BRIDGE_URL not configured' };
    try {
      const res = await fetch(`${base}/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridgeSecret()}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { bridgeUnavailable: true, reason: `bridge returned ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { bridgeUnavailable: true, reason: message };
    }
  }
}
