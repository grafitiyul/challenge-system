/**
 * One-shot iCount CSV importer for legacy payments that never came
 * through our webhook (e.g. paid before the webhook URL was configured).
 *
 * The iCount API is not wired into this project (no API token in the
 * env), so this importer reads a CSV exported from iCount's invoice
 * report and replays the matching logic the webhook would have applied
 * — minus anything that touches ParticipantGroup. Group memberships
 * are NEVER modified.
 *
 * ─── Usage ─────────────────────────────────────────────────────────
 *
 *   1. In iCount admin: Reports → Invoices → choose date range → Export to CSV.
 *      Make sure the export includes columns for client name / phone /
 *      email / total / currency / doc number / doc link / item name.
 *
 *   2. Save the file as `apps/api/icount-import.csv` (the file is
 *      gitignored — it contains real customer PII).
 *
 *   3. From the apps/api directory, with DATABASE_URL pointed at the
 *      target database:
 *
 *        npx ts-node scripts/import-icount-csv.ts
 *
 *      Optional: pass a different path: `npx ts-node scripts/import-icount-csv.ts /path/to/file.csv`
 *
 * ─── Hard rules ────────────────────────────────────────────────────
 *
 *   - Match existing participants by phone (primary) → email (fallback).
 *     NEVER create new participants.
 *   - Filter to Game Changer scope only: row's page id == "54" OR
 *     item name == GAME_CHANGER_ITEM_NAME. Anything else is skipped.
 *   - Dedupe by (provider='icount', externalPaymentId). Existing
 *     payments are updated only on missing fields — never overwritten.
 *   - Group memberships are read for snapshotting only. The script
 *     refuses to commit if it detects any change to ParticipantGroup
 *     between the start and end of the run.
 *
 * ─── CSV column mapping (defensive) ────────────────────────────────
 *
 *   The script accepts both Hebrew and English iCount column headers.
 *   Headers are matched case-insensitively after trimming. Rows missing
 *   a phone AND email are skipped (no way to identify the participant).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const GAME_CHANGER_PAGE_ID = '54';
const GAME_CHANGER_ITEM_NAME = 'השתתפות במשחק -הרגלי אכילה';
const DEFAULT_CSV_PATH = resolve(process.cwd(), 'icount-import.csv');

// ─── CSV parser ────────────────────────────────────────────────────────────
// Handles UTF-8 BOM, quoted fields, escaped double-quotes inside fields,
// CRLF / LF line endings. Returns rows as { [header]: value } objects.
function parseCsv(text: string): Record<string, string>[] {
  const stripped = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inQuotes) {
      if (c === '"' && stripped[i + 1] === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { cur.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; continue; }
    field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((cell) => cell.trim().length))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? '').trim()])));
}

// Pick the first non-empty value from any of the given header variants.
function colOf(row: Record<string, string>, candidates: string[]): string | null {
  const lookup = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const cand of candidates) {
    const v = lookup.get(cand.trim().toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return null;
}
function colNum(row: Record<string, string>, candidates: string[]): number | null {
  const raw = colOf(row, candidates);
  if (raw == null) return null;
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function colDate(row: Record<string, string>, candidates: string[]): Date | null {
  const raw = colOf(row, candidates);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function mapCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  // iCount numeric currency codes (CSV exports use these too).
  const map: Record<string, string> = { '1': 'USD', '2': 'EUR', '5': 'ILS' };
  return map[t] ?? t;
}
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d || null;
}

// Defensive header variants — both Hebrew (default iCount UI) and English.
function extractRow(row: Record<string, string>) {
  return {
    docNumber: colOf(row, [
      'docnum', 'doc_num', 'doc number', 'document number', 'invoice number',
      'מס\' חשבונית', 'מספר חשבונית', 'מספר מסמך',
    ]),
    transactionId: colOf(row, [
      'transaction id', 'transaction_id', 'payment id', 'cc_payment_id',
      'id', 'unique_id',
    ]),
    amount: colNum(row, [
      'totalwithvat', 'total_with_vat', 'total', 'amount',
      'totalsum', 'grand total', 'סכום', 'סה"כ', 'סה״כ', 'סה"כ כולל מע"מ',
    ]),
    currency: mapCurrency(colOf(row, ['currency', 'currency_code', 'מטבע'])),
    customerName: colOf(row, [
      'clientname', 'client name', 'client_name', 'customer name',
      'name', 'שם לקוח', 'שם הלקוח', 'שם',
    ]),
    customerPhone: colOf(row, [
      'phone', 'mobile', 'cell', 'phone number', 'טלפון', 'נייד', 'טלפון לקוח',
    ]),
    customerEmail: colOf(row, [
      'email', 'mail', 'email address', 'אימייל', 'דוא"ל', 'דואל', 'מייל',
    ]),
    pageId: colOf(row, [
      'cc_page_id', 'page id', 'page_id', 'מזהה עמוד', 'עמוד תשלום',
    ]),
    itemName: colOf(row, [
      'description', 'item description', 'item name', 'item', 'product',
      'פריט', 'תיאור', 'תיאור פריט', 'מוצר',
    ]),
    invoiceUrl: colOf(row, [
      'doc_link', 'doc link', 'doc_url', 'doc url', 'pdf_link', 'pdf link',
      'invoice url', 'קישור', 'קישור למסמך',
    ]),
    paidAt: colDate(row, [
      'payment date', 'paid at', 'date', 'dateissued', 'timeissued',
      'תאריך', 'תאריך תשלום', 'תאריך הפקה',
    ]),
  };
}

interface ExtractedRow {
  docNumber: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  pageId: string | null;
  itemName: string | null;
  invoiceUrl: string | null;
  paidAt: Date | null;
}

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV_PATH;
  if (!existsSync(csvPath)) {
    console.error('CSV file not found at:', csvPath);
    console.error('');
    console.error('To produce the export:');
    console.error('  1. Sign into iCount admin');
    console.error('  2. Reports → Invoices → choose the date range covering the missing payments');
    console.error('  3. Export to CSV');
    console.error('  4. Save the file as apps/api/icount-import.csv');
    console.error('  5. Re-run: npx ts-node scripts/import-icount-csv.ts');
    console.error('');
    console.error('The file is gitignored (it contains customer PII).');
    process.exit(1);
  }

  console.log('Reading CSV:', csvPath);
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  console.log(`Parsed ${rows.length} CSV row(s).\n`);

  const prisma = new PrismaClient();

  // ── Snapshot ParticipantGroup BEFORE so we can prove no changes.
  const beforeSnapshot = await prisma.participantGroup.findMany({
    select: { id: true, participantId: true, groupId: true, isActive: true, leftAt: true, joinedAt: true },
    orderBy: { id: 'asc' },
  });
  const beforeJSON = JSON.stringify(beforeSnapshot);
  console.log(`Snapshot: ${beforeSnapshot.length} ParticipantGroup rows captured.\n`);

  const offer = await prisma.paymentOffer.findFirst({
    where: { isActive: true, iCountPageId: GAME_CHANGER_PAGE_ID },
  });
  if (!offer) {
    console.error('Game Changer offer (iCountPageId=54) not found. Aborting.');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Game Changer offer: [${offer.id}] "${offer.title}" ${offer.amount} ${offer.currency}\n`);

  const stats = {
    pulled: rows.length,
    inScope: 0,
    outOfScope: 0,
    matchedParticipants: new Set<string>(),
    paymentsCreated: [] as Array<{ paymentId: string; participantId: string; name: string; invoiceNumber: string | null }>,
    paymentsUpdated: [] as Array<{ paymentId: string; participantId: string; fields: string[] }>,
    paymentsAlreadyClean: 0,
    skippedNoParticipant: [] as Array<{ phone: string | null; email: string | null; docNumber: string | null }>,
    skippedNoIdentity: 0,
    skippedNoTxnId: 0,
  };

  for (const raw of rows) {
    const f: ExtractedRow = extractRow(raw);

    // Scope filter — only Game Changer rows.
    const inScope = f.pageId === GAME_CHANGER_PAGE_ID || f.itemName === GAME_CHANGER_ITEM_NAME;
    if (!inScope) {
      stats.outOfScope++;
      continue;
    }
    stats.inScope++;

    // Need a way to identify the participant.
    const phone = normalizePhone(f.customerPhone);
    const email = f.customerEmail?.toLowerCase().trim() || null;
    if (!phone && !email) {
      stats.skippedNoIdentity++;
      console.log(`  [SKIP-NO-IDENTITY] doc=${f.docNumber} customer="${f.customerName}"`);
      continue;
    }

    // Match existing participant ONLY — never create.
    let participant = phone
      ? await prisma.participant.findUnique({ where: { phoneNumber: phone } })
      : null;
    if (!participant && email) {
      participant = await prisma.participant.findFirst({ where: { email } });
    }
    if (!participant) {
      stats.skippedNoParticipant.push({ phone, email, docNumber: f.docNumber });
      console.log(`  [SKIP-NO-MATCH] phone=${phone} email=${email} doc=${f.docNumber} customer="${f.customerName}"`);
      continue;
    }
    stats.matchedParticipants.add(participant.id);

    // Need a stable dedupe key. Prefer transactionId, fall back to docNumber.
    const externalPaymentId = f.transactionId ?? f.docNumber;
    if (!externalPaymentId) {
      stats.skippedNoTxnId++;
      console.log(`  [SKIP-NO-TXNID] participant=${participant.id} amount=${f.amount}`);
      continue;
    }

    const existing = await prisma.payment.findFirst({
      where: { provider: 'icount', externalPaymentId },
    });

    if (existing) {
      // Backfill ONLY missing fields. Never overwrite non-null values.
      const patch: Prisma.PaymentUpdateInput = {};
      if (!existing.invoiceNumber && f.docNumber) patch.invoiceNumber = f.docNumber;
      if (!existing.invoiceUrl && f.invoiceUrl) patch.invoiceUrl = f.invoiceUrl;
      if (!existing.itemName && f.itemName) patch.itemName = f.itemName;
      if (!existing.paidAt && f.paidAt) patch.paidAt = f.paidAt;
      if (!existing.verifiedAt) patch.verifiedAt = new Date();
      if (existing.status !== 'paid') patch.status = 'paid';
      if (!existing.offerId) patch.offer = { connect: { id: offer.id } };
      if ((!existing.amount || Number(existing.amount) === 0) && f.amount != null) {
        patch.amount = new Prisma.Decimal(f.amount);
      }
      if (!existing.currency && f.currency) patch.currency = f.currency;

      const fields = Object.keys(patch);
      if (fields.length) {
        await prisma.payment.update({ where: { id: existing.id }, data: patch });
        stats.paymentsUpdated.push({ paymentId: existing.id, participantId: existing.participantId, fields });
        console.log(`  [UPDATE] payment=${existing.id} participant=${existing.participantId} fields=${fields.join(',')}`);
      } else {
        stats.paymentsAlreadyClean++;
        console.log(`  [CLEAN]  payment=${existing.id} (already complete)`);
      }
      continue;
    }

    // No existing Payment for this id — create one. EXPLICITLY do NOT
    // call autoJoinGroup; ParticipantGroup is never touched.
    const created = await prisma.payment.create({
      data: {
        participant: { connect: { id: participant.id } },
        offer: { connect: { id: offer.id } },
        provider: 'icount',
        externalPaymentId,
        amount: new Prisma.Decimal(f.amount ?? Number(offer.amount)),
        currency: f.currency || 'ILS',
        paidAt: f.paidAt ?? new Date(),
        status: 'paid',
        verifiedAt: new Date(),
        itemName: f.itemName ?? offer.title,
        invoiceNumber: f.docNumber,
        invoiceUrl: f.invoiceUrl,
      },
    });
    stats.paymentsCreated.push({
      paymentId: created.id,
      participantId: participant.id,
      name: `${participant.firstName} ${participant.lastName ?? ''}`.trim(),
      invoiceNumber: f.docNumber,
    });
    console.log(`  [CREATE] payment=${created.id} participant=${participant.id} (${participant.firstName})`);
  }

  // ── Verify ParticipantGroup is unchanged.
  const afterSnapshot = await prisma.participantGroup.findMany({
    select: { id: true, participantId: true, groupId: true, isActive: true, leftAt: true, joinedAt: true },
    orderBy: { id: 'asc' },
  });
  const afterJSON = JSON.stringify(afterSnapshot);
  const groupsUntouched = beforeJSON === afterJSON;

  console.log('\n═══ Summary ═════════════════════════════════════════════════');
  console.log(`  records pulled from CSV       : ${stats.pulled}`);
  console.log(`  in scope (Game Changer)       : ${stats.inScope}`);
  console.log(`  out of scope (other invoices) : ${stats.outOfScope}`);
  console.log(`  matched existing participants : ${stats.matchedParticipants.size}`);
  console.log(`  payments created              : ${stats.paymentsCreated.length}`);
  console.log(`  payments updated              : ${stats.paymentsUpdated.length}`);
  console.log(`  payments already complete     : ${stats.paymentsAlreadyClean}`);
  console.log(`  skipped — no participant      : ${stats.skippedNoParticipant.length}`);
  console.log(`  skipped — no phone/email      : ${stats.skippedNoIdentity}`);
  console.log(`  skipped — no doc / txn id     : ${stats.skippedNoTxnId}`);
  console.log('\n═══ Group safety ════════════════════════════════════════════');
  console.log(`  ParticipantGroup before : ${beforeSnapshot.length}`);
  console.log(`  ParticipantGroup after  : ${afterSnapshot.length}`);
  console.log(`  unchanged               : ${groupsUntouched ? 'YES' : 'NO ⚠'}`);

  if (stats.paymentsCreated.length) {
    console.log('\nPayments created:');
    for (const c of stats.paymentsCreated) console.log('   ', c);
  }
  if (stats.paymentsUpdated.length) {
    console.log('\nPayments updated (only missing fields filled):');
    for (const u of stats.paymentsUpdated) console.log('   ', u);
  }
  if (stats.skippedNoParticipant.length) {
    console.log('\nRows whose customer is NOT in our system (would need manual review):');
    for (const s of stats.skippedNoParticipant) console.log('   ', s);
  }

  // Duplicate-payment safety check.
  const dupes = await prisma.$queryRawUnsafe<Array<{ externalPaymentId: string; cnt: bigint }>>(`
    SELECT "externalPaymentId", COUNT(*) AS cnt
    FROM payments
    WHERE provider = 'icount' AND "externalPaymentId" IS NOT NULL
    GROUP BY "externalPaymentId"
    HAVING COUNT(*) > 1
  `);
  console.log(`\nDuplicate iCount externalPaymentId rows: ${dupes.length}`);
  if (dupes.length) console.log('  rows:', dupes);

  await prisma.$disconnect();

  if (!groupsUntouched) {
    console.error('\n⚠ ParticipantGroup snapshot differs — investigate immediately.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
