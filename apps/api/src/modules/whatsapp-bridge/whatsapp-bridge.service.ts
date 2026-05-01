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
}

function bridgeUrl(): string | null {
  const v = process.env['WHATSAPP_BRIDGE_URL'];
  if (!v || !v.trim()) return null;
  return v.trim().replace(/\/+$/, '');
}

function bridgeSecret(): string {
  const v = process.env['INTERNAL_API_SECRET'];
  if (!v) {
    throw new ServiceUnavailableException('INTERNAL_API_SECRET not configured');
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
      throw new ServiceUnavailableException('שירות WhatsApp לא מוגדר. פנה למנהל המערכת.');
    }
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
      throw new ServiceUnavailableException(`גשר WhatsApp לא זמין (${reason}).`);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { externalMessageId?: string };
      if (!json.externalMessageId) {
        throw new ServiceUnavailableException('הגשר החזיר תגובה ללא מזהה הודעה.');
      }
      return { ok: true, externalMessageId: json.externalMessageId };
    }

    // Map bridge error codes to user-facing Hebrew messages. The bridge
    // returns 503 with { error: 'whatsapp_not_connected' } when the
    // socket is down — this is the case the admin UI should render as
    // "WhatsApp לא מחובר כרגע".
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    if (res.status === 503 && body.error === 'whatsapp_not_connected') {
      throw new ServiceUnavailableException('WhatsApp לא מחובר כרגע. פתחי את "מצב חיבור" וסרקי קוד QR.');
    }
    if (res.status === 400) {
      if (body.error === 'phone_invalid') {
        throw new BadRequestException('מספר טלפון לא תקין.');
      }
      if (body.error === 'phone_required' || body.error === 'message_required') {
        throw new BadRequestException('מספר טלפון והודעה הם שדות חובה.');
      }
    }
    throw new ServiceUnavailableException(
      `שליחה דרך הגשר נכשלה (${res.status}${body.detail ? `: ${body.detail}` : ''}).`,
    );
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
