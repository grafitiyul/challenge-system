// Centralised env-var loading. The bridge uses the SAME DATABASE_URL
// as the API so they share Prisma data. INTERNAL_API_SECRET is a
// shared secret used to authenticate API → bridge HTTP calls.
//
// Phase 1 does not implement media storage; the R2_* values are
// declared here for forward-compat so Phase 2 can swap implementations
// without re-touching env handling. They're intentionally optional.

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`[bridge] required env var ${name} is missing`);
  }
  return v.trim();
}

function optional(name: string, defaultValue?: string): string | undefined {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  return defaultValue;
}

function int(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),

  // Internal-only HTTP server. Default '::' is the IPv6 wildcard, which
  // on Linux dual-stacks to accept BOTH IPv6 and IPv4 traffic — strictly
  // more permissive than '0.0.0.0' and required for Railway.
  //
  // Why '::' specifically: Railway's internal service-to-service network
  // (`<service>.railway.internal`) routes over IPv6 by default. Binding
  // to '0.0.0.0' (the previous default) means the bridge listens on IPv4
  // only; IPv6 traffic from the API hits a kernel that has nothing
  // listening, the syscall returns no SYN-ACK, and the API's fetch sits
  // silently until AbortSignal.timeout fires after 15s — exactly the
  // "The operation was aborted due to timeout" symptom seen in production.
  // BRIDGE_HTTP_HOST env override stays in place for non-Railway envs
  // that need explicit IPv4 binding (rare).
  //
  // Endpoints: /health, /status, /sign-out, /send.
  httpHost: optional('BRIDGE_HTTP_HOST', '::')!,
  httpPort: int('PORT', int('BRIDGE_HTTP_PORT', 4001)),

  // Shared secret for API → bridge auth. Both services must agree on
  // the same value. Sent as `Authorization: Bearer <secret>`.
  internalApiSecret: required('INTERNAL_API_SECRET'),

  // Baileys-side knobs. Pinning a Baileys version is what we depend on;
  // these are runtime tunables.
  reconnectMinDelayMs: int('BRIDGE_RECONNECT_MIN_MS', 1000),
  reconnectMaxDelayMs: int('BRIDGE_RECONNECT_MAX_MS', 60_000),
  // Treat the connection as "healthy" after staying open this long, so
  // the next disconnect resets the backoff to its minimum.
  reconnectHealthyMs:  int('BRIDGE_RECONNECT_HEALTHY_MS', 5 * 60_000),

  logLevel: optional('LOG_LEVEL', 'info')!,

  // ── R2 / media (Phase 2 wiring; left as planning placeholders) ──────
  // The bridge will eventually upload media to Cloudflare R2 (S3-compat)
  // and store the resulting key in WhatsAppMessage.mediaUrl. Phase 1
  // doesn't touch any of these; the values are loaded eagerly only
  // when MEDIA_STORAGE='r2' so a Phase 1 deploy without R2 configured
  // still boots cleanly.
  mediaStorage: optional('MEDIA_STORAGE', 'disabled')!, // 'disabled' | 'disk' | 'r2'
  r2Endpoint: optional('R2_ENDPOINT'),
  r2Bucket: optional('R2_BUCKET'),
  r2AccessKeyId: optional('R2_ACCESS_KEY_ID'),
  r2SecretAccessKey: optional('R2_SECRET_ACCESS_KEY'),
  // Where the public-readable URL of an R2 object lives (custom domain
  // or worker-exposed). Phase 2 pastes the file key onto this base.
  mediaPublicUrlBase: optional('MEDIA_PUBLIC_URL_BASE'),
};
