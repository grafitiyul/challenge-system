// Defensive payload extractor for iCount webhook POSTs.
//
// iCount's webhook schema isn't fully stable across integration types
// (payment-page vs API-triggered invoices vs receipts), so we probe a
// generous set of common field names and fall back to nested `items[0]`
// / `client` / `customer` structures. Unknown payloads still store
// their raw JSON in IcountWebhookLog.rawPayload for manual review.
//
// Every field returned here is OPTIONAL — the matcher decides what to
// do with partial data.

export interface ExtractedFields {
  docNumber: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  customerName: string | null;       // full name (if only one field is sent)
  customerFirstName: string | null;  // when split
  customerLastName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  pageId: string | null;
  itemName: string | null;
  invoiceUrl: string | null;
  paidAt: Date | null;
}

// Safely read a nested string/number/date out of an arbitrary JSON
// object. Returns null for empty strings and non-primitives.
function pick(src: unknown, keys: string[]): string | null {
  if (!src || typeof src !== 'object') return null;
  const o = src as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNumber(src: unknown, keys: string[]): number | null {
  const raw = pick(src, keys);
  if (raw == null) return null;
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pickDate(src: unknown, keys: string[]): Date | null {
  const raw = pick(src, keys);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function extractIcountFields(body: unknown): ExtractedFields {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  // iCount sometimes nests customer info under `client` / `customer`.
  const client = (b.client ?? b.customer ?? b.cust ?? b) as Record<string, unknown>;

  // Line items may live on `items[]` or `docs[0].items[]` — probe a few.
  const items = Array.isArray(b.items)
    ? (b.items as unknown[])
    : Array.isArray((b as { doc?: { items?: unknown[] } }).doc?.items)
    ? ((b as { doc: { items: unknown[] } }).doc.items as unknown[])
    : [];
  const firstItem = items[0] as Record<string, unknown> | undefined;

  return {
    docNumber: pick(b, ['doc_num', 'doc_number', 'docNumber', 'invoice_num', 'invoiceNumber', 'number']),
    transactionId: pick(b, [
      'transaction_id', 'transactionId', 'trans_id', 'txn_id',
      'doc_id', 'docId', 'payment_id', 'paymentId', 'unique_id',
    ]),
    amount: pickNumber(b, ['total', 'doc_total', 'docTotal', 'sum', 'amount', 'grand_total']),
    currency: pick(b, ['currency', 'currency_code', 'currencyCode']) || 'ILS',
    customerName: pick(client, ['client_name', 'clientName', 'name', 'full_name', 'fullName', 'cust_name']),
    customerFirstName: pick(client, ['first_name', 'firstName', 'fname', 'given_name']),
    customerLastName: pick(client, ['last_name', 'lastName', 'lname', 'surname', 'family_name']),
    customerPhone: pick(client, ['phone', 'mobile', 'cell', 'phone_number', 'phoneNumber', 'tel']),
    customerEmail: pick(client, ['email', 'mail', 'email_address', 'emailAddress']),
    pageId: pick(b, ['page_id', 'pageId', 'pp_id', 'payment_page_id', 'paymentPageId']),
    itemName: pick(firstItem ?? {}, ['name', 'description', 'item_name', 'itemName', 'title'])
      ?? pick(b, ['item_name', 'itemName', 'description']),
    invoiceUrl: pick(b, ['doc_url', 'docUrl', 'pdf_url', 'pdfUrl', 'invoice_url', 'invoiceUrl', 'url']),
    paidAt: pickDate(b, ['paid_at', 'paidAt', 'payment_date', 'paymentDate', 'created_at', 'createdAt', 'date', 'doc_date']),
  };
}

// Splits a single-field full name into { first, last }. Hebrew names
// often arrive as one string; we take the first token as first name and
// join the rest as last name. Trivially reversible by admin if wrong.
export function splitName(
  full: string | null,
  first: string | null,
  last: string | null,
): { first: string | null; last: string | null } {
  if (first || last) return { first, last };
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Normalize Israeli phone numbers for matching. Strips non-digits and
// removes a leading "972" country code so both "+972501234567" and
// "0501234567" resolve to the same Participant row.
export function normalizeIsraeliPhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return digits || null;
}
