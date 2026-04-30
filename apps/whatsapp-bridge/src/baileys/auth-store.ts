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

const CREDS_KIND = 'creds';
const CREDS_KEY_ID = 'singleton';

type SignalDataKind = keyof SignalDataTypeMap;

// Round-trip a value through BufferJSON so the resulting object is a
// pure-JSON tree. Prisma's Json column accepts that directly.
function encode(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function decode<T>(json: Prisma.JsonValue): T {
  return JSON.parse(JSON.stringify(json), BufferJSON.reviver) as T;
}

export interface PostgresAuthHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  // Wipe ALL auth rows (creds + every signal key). Used by the admin
  // "Sign out / forget device" action. Idempotent.
  clear: () => Promise<void>;
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

  return {
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
    },

    clear: async () => {
      await prisma.whatsAppSession.deleteMany({});
    },
  };
}
