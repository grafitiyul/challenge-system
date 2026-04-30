# whatsapp-bridge

Baileys-backed WhatsApp bridge service. Replaces the legacy Wassenger
integration. Lives in its own Railway service; shares Postgres with
the API but runs as an independent process.

## Phase 1 scope (this commit)

- Postgres-backed Baileys auth state (`WhatsAppSession`).
- Connection lifecycle persisted to `WhatsAppConnection` (singleton row).
- Reconnect with exponential backoff; loggedOut → wipe creds + wait
  for re-pair.
- Internal HTTP server: `GET /health`, `GET /status`, `POST /sign-out`.
- Admin UI at `/admin/whatsapp` proxies via the API.

NOT in Phase 1 (deliberately):

- `messages.upsert` ingestion to `WhatsAppMessage`.
- Outbound `/send`.
- Media download / R2 upload.
- History sync replay.
- Group sync.

## Cutover from Wassenger

Wassenger and Baileys cannot coexist on the same WhatsApp number. Run
this sequence before pairing the bridge:

1. **Wassenger Cloud dashboard**: remove the webhook URL pointing to
   `${API_URL}/api/wassenger`. Otherwise WhatsApp messages will still
   land on the Wassenger device and queue.
2. **API Railway service**: set `WASSENGER_ENABLED=false`. The webhook
   endpoint will return `{ ok: true, disabled: true }` and the send
   endpoint will return 410 Gone.
3. **WhatsApp on the phone**: open WhatsApp → Settings → Linked devices.
   Remove the Wassenger session. This frees one of the multi-device
   slots so the bridge's session can take it.
4. **Bridge**: deploy and pair (see below).

If you skip step 1, our endpoint will discard the body and Wassenger
Cloud will eventually retry-then-give-up — no harm, just noise. If you
skip step 3, WhatsApp may refuse the bridge's pairing because the
device limit is full.

## Local dev

```bash
cd apps/whatsapp-bridge
npm install               # at the monorepo root, npm install hoists
npm run dev
```

Required env vars (see `src/config.ts`):

| var | purpose |
|---|---|
| `DATABASE_URL` | Same Postgres as the API. |
| `INTERNAL_API_SECRET` | Shared with the API; gates `/status` and `/sign-out`. |
| `PORT` or `BRIDGE_HTTP_PORT` | Default 4001. |
| `LOG_LEVEL` | `info` (default) / `warn` / `debug`. |

Optional Phase 2 env vars (declared now, ignored until Phase 2):

| var | purpose |
|---|---|
| `MEDIA_STORAGE` | `disabled` (default) / `disk` / `r2`. |
| `R2_ENDPOINT` | e.g. `https://<account>.r2.cloudflarestorage.com`. |
| `R2_BUCKET` | Bucket name. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API token. |
| `MEDIA_PUBLIC_URL_BASE` | Base URL for the public-readable media endpoint (custom domain or worker). |

## Railway service setup (one-time)

Create a new Railway service in the same project as the API:

1. New service → connect to this repo → root directory `apps/whatsapp-bridge`.
2. Build command: `npm install && npm run build`.
   - The bridge's `postinstall` runs `prisma generate
     --schema=../api/prisma/schema.prisma`, which generates the
     Prisma client using the API's shared schema. The `build` script
     also runs `prisma:generate` first as a belt-and-braces, so the
     client exists even if Railway happens to skip postinstall.
   - Do NOT pass `--workspaces=false` — that flag was the original
     cause of "@prisma/client did not initialize yet" because it
     suppressed the postinstall hook.
3. Start command: `npm run start`.
   - `start` runs `prisma generate` AGAIN before `node dist/index.js`.
     This is the third defence layer and the only one that's
     guaranteed to fire on every container boot. Some Railway build
     pipelines (Nixpacks with separate build/runtime images, or
     aggressive node_modules caching that bypasses postinstall) end
     up with a runtime container whose `@prisma/client` is just the
     stub, and importing it throws "did not initialize yet". Running
     generate at boot fixes that regardless of which path Railway
     chose during build. The cost is ~500ms of startup time, which
     is negligible for a service that stays connected for days.
4. Env vars: copy `DATABASE_URL` from the API service. Set
   `INTERNAL_API_SECRET` (same value on both services). Set `PORT` to
   whatever Railway exposes; the internal URL becomes
   `whatsapp-bridge.railway.internal:<port>`.
5. On the API service, set `WHATSAPP_BRIDGE_URL=http://whatsapp-bridge.railway.internal:<port>`
   and `INTERNAL_API_SECRET=<same secret>`.

Health check: `GET /health` returns `{ ok: true }`. Use this for
Railway's health probe.

Schema location: `prisma generate` reads `../api/prisma/schema.prisma`
relative to `apps/whatsapp-bridge`. Railway clones the full repo so
that relative path resolves at build time. If you ever change the
service to a sparse checkout that excludes `apps/api`, the bridge
build will fail at `prisma generate` — copy the schema in or restore
the full checkout.

## Pairing

After deploying, open `/admin/whatsapp` in the web UI. The page polls
every 2 s while disconnected; the QR appears within a tick of the
bridge emitting it. Scan with the phone (WhatsApp → Settings → Linked
devices → Link a device). The page flips to "מחובר" once paired.

If the QR expires before scanning, just wait — Baileys rotates QRs
every ~20 s. The next code appears automatically.

## R2 plan (Phase 2 wiring)

Phase 2 will add a `MediaStorage` interface with two implementations:

- `DiskMediaStorage` — writes to `/data/uploads/whatsapp/<YYYY>/<MM>/<chatId>/<msgId>.<ext>`.
  Same persistent volume the participant-portal uses today.
- `R2MediaStorage` — uploads to a Cloudflare R2 bucket via the
  `@aws-sdk/client-s3` package configured with R2's S3-compatible
  endpoint. Public read via either a custom domain or signed URLs.

`MEDIA_STORAGE=r2` selects R2; `disk` keeps using the persistent volume;
`disabled` skips media downloads entirely (text-only ingestion). The
bridge writes the resulting URL into `WhatsAppMessage.mediaUrl` and
metadata into the new `mediaMimeType` / `mediaSizeBytes` /
`mediaOriginalName` columns.

R2 advantages over disk:

- Zero egress fees → cheap to serve media to multiple admins.
- Survives Railway service rebuilds without volume migration.
- Easier to back up / mirror to S3.
- Public CDN-ish access via Cloudflare.

The trade-off is one extra dependency (`@aws-sdk/client-s3`) and two
extra env-var tuples. We default to `disabled` so Phase 1 deploys
cleanly without R2 configured.

## Risks recap

- **Account ban**: WhatsApp can flag automated activity. Keep volume
  low (≤ 30 msg/hr default in Phase 3), use a dedicated number, don't
  blast group invites. Same risk profile as Wassenger had under the
  hood.
- **Protocol drift**: WhatsApp occasionally changes things. Watch
  `@whiskeysockets/baileys` releases; pin a known-good version in
  `package.json`.
- **Multi-device slot**: WhatsApp allows ~4 linked devices. Keep the
  bridge in one slot. Re-pairing reuses the slot.
