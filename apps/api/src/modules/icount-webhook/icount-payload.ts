// Defensive payload extractor for iCount webhook POSTs.
//
// Field names below are based on real production payloads received from
// iCount's payment-page integration. The actual schema uses:
//   - `docnum` (not `doc_num`) at root for invoice number
//   - `clientname` at ROOT (not nested under `client.name`)
//   - `client.email`, `client.phone`, `client.mobile` for customer contact
//   - `totalwithvat` and `totalsum` for amount (totalwithvat is final)
//   - `currency: "5"` numeric code (5 = ILS)
//   - `custom.cc_page_id` (nested) for the payment page id
//   - `cc_payments[0].id` for the unique transaction id
//   - `dateissued`, `timeissued` for paid date
//   - `doc_link`, `pdf_link` for invoice URL
//   - `items[0].description` for the line item name
//
// We still probe a generous set of fallbacks for older / alternate iCount
// integrations. Unknown payloads still store their raw JSON in
// IcountWebhookLog.rawPayload for manual review.
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

// iCount sends `currency` as a numeric code (e.g. "5" for ILS). Map it
// to the standard ISO-4217 string we store on Payment.currency. Strings
// that already look like ISO codes ("ILS", "USD") pass through.
function mapCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  // Numeric iCount currency codes observed in production payloads.
  const map: Record<string, string> = {
    '1': 'USD',
    '2': 'EUR',
    '5': 'ILS',
  };
  return map[trimmed] ?? trimmed;
}

export function extractIcountFields(body: unknown): ExtractedFields {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  // Customer info: iCount nests email / phone / mobile under `client`,
  // but the human-readable name is at root as `clientname`.
  const client = (b.client ?? b.customer ?? b.cust ?? {}) as Record<string, unknown>;

  // Line items live on `items[]` (root). Older integrations used `doc.items[]`.
  const items = Array.isArray(b.items)
    ? (b.items as unknown[])
    : Array.isArray((b as { doc?: { items?: unknown[] } }).doc?.items)
    ? ((b as { doc: { items: unknown[] } }).doc.items as unknown[])
    : [];
  const firstItem = items[0] as Record<string, unknown> | undefined;

  // `cc_payments[]` carries the credit-card transaction details when the
  // invoice was paid via iCount's payment page.
  const ccPayments = Array.isArray(b.cc_payments) ? (b.cc_payments as unknown[]) : [];
  const firstCc = ccPayments[0] as Record<string, unknown> | undefined;

  // `custom` holds page-builder metadata, including `cc_page_id` which
  // lets us match a specific payment page to a PaymentOffer.
  const custom = (b.custom ?? {}) as Record<string, unknown>;

  return {
    docNumber: pick(b, ['docnum', 'doc_num', 'doc_number', 'docNumber', 'invoice_num', 'invoiceNumber', 'number']),
    // Prefer the credit-card payment id (unique per charge); fall back to
    // the doc number which is also unique per invoice.
    transactionId:
      pick(firstCc ?? {}, ['id', 'transaction_id', 'trans_id']) ??
      pick(b, [
        'transaction_id', 'transactionId', 'trans_id', 'txn_id',
        'payment_id', 'paymentId', 'unique_id',
        'docnum', 'doc_num',
      ]),
    // `totalwithvat` is the VAT-included grand total; `totalsum` is the
    // pre-VAT subtotal. Use VAT-included as the canonical paid amount.
    amount: pickNumber(b, ['totalwithvat', 'total_with_vat', 'totalSumWithVat', 'total', 'doc_total', 'docTotal', 'totalsum', 'sum', 'amount', 'grand_total']),
    currency: mapCurrency(pick(b, ['currency', 'currency_code', 'currencyCode'])) || 'ILS',
    customerName:
      pick(b, ['clientname', 'client_name', 'clientName', 'customer_name', 'fullName', 'full_name']) ??
      pick(client, ['client_name', 'clientName', 'name', 'full_name', 'fullName', 'cust_name']),
    customerFirstName: pick(client, ['first_name', 'firstName', 'fname', 'given_name']),
    customerLastName: pick(client, ['last_name', 'lastName', 'lname', 'surname', 'family_name']),
    customerPhone:
      pick(client, ['phone', 'mobile', 'cell', 'phone_number', 'phoneNumber', 'tel']) ??
      pick(b, ['phone', 'mobile', 'client_phone', 'customer_phone']),
    customerEmail:
      pick(client, ['email', 'mail', 'email_address', 'emailAddress']) ??
      pick(b, ['email', 'client_email', 'customer_email']),
    pageId:
      pick(custom, ['cc_page_id', 'page_id', 'pageId']) ??
      pick(b, ['page_id', 'pageId', 'pp_id', 'cc_page_id', 'payment_page_id', 'paymentPageId']),
    itemName: pick(firstItem ?? {}, ['description', 'name', 'item_name', 'itemName', 'title'])
      ?? pick(b, ['item_name', 'itemName', 'description']),
    invoiceUrl: pick(b, ['doc_link', 'docLink', 'pdf_link', 'pdfLink', 'doc_url', 'docUrl', 'pdf_url', 'pdfUrl', 'invoice_url', 'invoiceUrl', 'url']),
    paidAt:
      pickDate(firstCc ?? {}, ['payment_date', 'paymentDate']) ??
      pickDate(b, ['timeissued', 'dateissued', 'paid_at', 'paidAt', 'payment_date', 'paymentDate', 'created_at', 'createdAt', 'date', 'doc_date']),
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
