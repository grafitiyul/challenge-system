// Thin proxy from the API to the WhatsApp bridge service. The admin
// UI never talks to the bridge directly — it goes through these
// admin-guarded routes which forward to the bridge's internal HTTP
// server using the shared INTERNAL_API_SECRET.
//
// We keep the proxy minimal:
//   - GET /api/admin/whatsapp/status   → bridge GET  /status
//   - POST /api/admin/whatsapp/sign-out → bridge POST /sign-out
//
// If the bridge URL is missing or the bridge is offline, every endpoint
// returns a typed "bridge_unavailable" payload so the admin UI can
// distinguish "the bridge is disconnected from WhatsApp" from "the
// bridge process is itself down".

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

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
