// Postgres-backed Baileys AuthenticationState.
//
// Mirrors useMultiFileAuthState() but persists into the WhatsAppSession
// table instead of disk. Two reasons we don't use the file-based helper:
//   1. Railway's volumes are per-service. Storing auth on disk would
//      mean a redeploy that recreates the bridge pod loses the
//      session, forcing a re-pair.
//   2. Centralised persistence lets us inspect / wipe credentials from
//      the admin UI without shelling into the container.
//
// Serialisation uses Baileys' standard BufferJSON replacer/reviver so
// binary signal keys round-trip through Postgres JSONB losslessly. The
// shape stored per row is exactly what the disk variant would write —
// kind matches the file's "type", keyId matches the file's "id".

import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { Prisma, PrismaClient } from '@prisma/client';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info', name: 'auth-store' });

const CREDS_KIND = 'creds';
const CREDS_KEY_ID = 'singleton';

type SignalDataKind = keyof SignalDataTypeMap;

// Round-trip a value through BufferJSON so the resulting object is a
// pure-JSON tree. Prisma's Json column accepts that directly at
// runtime, but the *types* `Prisma.InputJsonValue` and
// `Prisma.JsonValue` are not exposed in the `@prisma/client/default`
// export path used by Railway's build (Prisma 6.x reorganised those
// exports). Returning `any` from encode and `unknown` for the decode
// input keeps this helper portable across Prisma client generations
// without forcing every call site to cast.
//
// The values themselves come from JSON.parse, so the runtime shape is
// always a JSON-safe tree regardless of the static type.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function encode(value: unknown): any {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function decode<T>(json: unknown): T {
  return JSON.parse(JSON.stringify(json), BufferJSON.reviver) as T;
}

export interface PostgresAuthHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  // Wipe ALL auth rows (creds + every signal key). Used by the admin
  // "Sign out / forget device" action. Idempotent.
  clear: () => Promise<void>;
  // Diagnostic — what was loaded from Postgres at construction time.
  // Surfaced by the bridge's startup log so we can tell at a glance
  // whether a deploy resumed an existing session or had to pair from
  // scratch.
  hasCreds: boolean;
  keyCount: number;
}

export async function makePostgresAuthState(
  prisma: PrismaClient,
): Promise<PostgresAuthHandle> {
  // Load or initialise the singleton creds row.
  const credsRow = await prisma.whatsAppSession.findUnique({
    where: { kind_keyId: { kind: CREDS_KIND, keyId: CREDS_KEY_ID } },
  });
  const creds: AuthenticationCreds = credsRow
    ? decode<AuthenticationCreds>(credsRow.data)
    : initAuthCreds();

  // Count signal-key rows by kind so the load log is useful for
  // debugging "did creds + keys actually persist?". groupBy is one
  // indexed query — no sensitive data is read.
  const counts = await prisma.whatsAppSession.groupBy({
    by: ['kind'],
    _count: { _all: true },
  });
  const keyCount = counts.reduce(
    (sum, row) => sum + (row.kind === CREDS_KIND ? 0 : row._count._all),
    0,
  );
  log.info(
    { hasCreds: !!credsRow, keyCount, byKind: counts.map((c) => ({ kind: c.kind, count: c._count._all })) },
    'loaded auth state from postgres',
  );

  return {
    hasCreds: !!credsRow,
    keyCount,
    state: {
      creds,
      keys: {
        // Baileys requests N keys of a specific type at once; we satisfy
        // the read with one indexed query. Returning {} for missing keys
        // is required — Baileys treats undefined as "not yet stored".
        get: async <T extends SignalDataKind>(
          type: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          if (ids.length === 0) return {};
          const rows = await prisma.whatsAppSession.findMany({
            where: { kind: type, keyId: { in: ids } },
            select: { keyId: true, data: true },
          });
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const row of rows) {
            const value = decode<SignalDataTypeMap[T]>(row.data);
            // app-state-sync-key needs to be revived as a protobuf
            // message; Baileys' upstream behaviour expects the typed
            // class instance, not just the plain object. The double
            // cast through unknown is the documented Baileys pattern
            // for this branch — SignalDataTypeMap is a tagged union
            // and TS can't narrow it from the runtime `type` string.
            if (type === 'app-state-sync-key' && value) {
              const revived = proto.Message.AppStateSyncKeyData.fromObject(
                value as object,
              );
              out[row.keyId] = revived as unknown as SignalDataTypeMap[T];
            } else {
              out[row.keyId] = value;
            }
          }
          return out;
        },

        // Baileys passes {[type]: {[id]: data | null}}. null means
        // "delete this key". We translate to upserts + targeted
        // deletes inside a single transaction so a partial failure
        // doesn't leave the auth half-written.
        set: async (data) => {
          const upserts: Prisma.PrismaPromise<unknown>[] = [];
          const deletes: { kind: string; keyId: string }[] = [];
          for (const rawKind of Object.keys(data)) {
            const kind = rawKind as SignalDataKind;
            const inner = data[kind];
            if (!inner) continue;
            for (const id of Object.keys(inner)) {
              const value = inner[id];
              if (value === null || value === undefined) {
                deletes.push({ kind, keyId: id });
                continue;
              }
              upserts.push(
                prisma.whatsAppSession.upsert({
                  where: { kind_keyId: { kind, keyId: id } },
                  create: { kind, keyId: id, data: encode(value) },
                  update: { data: encode(value) },
                }),
              );
            }
          }
          if (upserts.length > 0 || deletes.length > 0) {
            await prisma.$transaction([
              ...upserts,
              ...deletes.map((d) =>
                prisma.whatsAppSession.deleteMany({
                  where: { kind: d.kind, keyId: d.keyId },
                }),
              ),
            ]);
          }
        },
      },
    },

    saveCreds: async () => {
      await prisma.whatsAppSession.upsert({
        where: { kind_keyId: { kind: CREDS_KIND, keyId: CREDS_KEY_ID } },
        create: { kind: CREDS_KIND, keyId: CREDS_KEY_ID, data: encode(creds) },
        update: { data: encode(creds) },
      });
      log.debug('creds.update saved');
    },

    clear: async () => {
      // Explicit wipe. Only the admin "Sign out" path calls this;
      // the connection.update loggedOut handler intentionally does
      // NOT, because the same protocol code is used for benign
      // deploy-overlap kicks and we'd lose valid creds either way.
      const { count } = await prisma.whatsAppSession.deleteMany({});
      log.warn({ deletedRows: count }, 'auth state wiped');
    },
  };
}
