/**
 * Turn a collection-account statement (CSV) into the rows
 * admin_import_mpesa_statement() takes (migration 20261015190000). The database
 * re-validates every row; this only reads the file.
 *
 * The M-Pesa org portal export is recognised by its column names ("Receipt No.",
 * "Completion Time", "Paid In", "Withdrawn", "Transaction Status", "Other Party
 * Info", "Linked Transaction ID", "A/C No."). A bank's export varies, so the
 * admin can map the columns by hand; detection only pre-fills the choices.
 */

export type StatementRow = { receipt: string; completed_at: string; amount_kes: number; payer_hint?: string; account_ref?: string; fee_kes?: number };
export type ColumnMap = { receipt: number; time: number; amount: number; withdrawn: number; status: number; payer: number; account: number; linked: number };
export type ParsedSheet = { header: string[]; body: string[][]; headerRow: number };

/** RFC 4180-ish CSV: quotes, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const CANDIDATES: Record<keyof ColumnMap, string[]> = {
  receipt: ["receiptno", "receipt", "receiptnumber", "transactionid", "mpesareceipt", "transid", "reference"],
  time: ["completiontime", "completedtime", "transactiontime", "date", "transactiondate", "valuedate", "time"],
  amount: ["paidin", "amount", "credit", "creditamount", "deposit", "transamount"],
  withdrawn: ["withdrawn", "debit", "debitamount", "withdrawal"],
  status: ["transactionstatus", "status"],
  payer: ["otherpartyinfo", "otherparty", "payer", "msisdn", "customer", "name"],
  account: ["acno", "accountno", "billrefnumber", "accountnumber", "account", "accountreference"],
  linked: ["linkedtransactionid", "linkedtransaction", "linkedreceipt"],
};

/** Find the header row (the first row naming a receipt and an amount column) and guess the map. */
export function detect(rows: string[][]): { sheet: ParsedSheet; map: ColumnMap } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const h = rows[r].map(norm);
    const find = (k: keyof ColumnMap) => { for (const c of CANDIDATES[k]) { const i = h.indexOf(c); if (i >= 0) return i; } return -1; };
    const map: ColumnMap = { receipt: find("receipt"), time: find("time"), amount: find("amount"), withdrawn: find("withdrawn"),
      status: find("status"), payer: find("payer"), account: find("account"), linked: find("linked") };
    if (map.receipt >= 0 && map.amount >= 0) {
      return { sheet: { header: rows[r], body: rows.slice(r + 1), headerRow: r }, map };
    }
  }
  return null;
}

const money = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

/**
 * "2026-10-17 14:03:22", "17-10-2026 14:03:22", "17/10/2026 2:03:22 PM", or ISO.
 * Statements print Nairobi time without a zone: read as UTC+3.
 */
export function parseTime(v: string): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(t) && !Number.isNaN(Date.parse(t))) return new Date(t).toISOString();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  let hh = +m[4];
  const ap = (m[7] ?? "").toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${m[5]}:${m[6] ?? "00"}+03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

/**
 * Incoming, completed payments only. Withdrawals that name a linked receipt
 * (the M-Pesa charge for that payment) become that receipt's fee.
 */
export function toRows(sheet: ParsedSheet, map: ColumnMap): { rows: StatementRow[]; skipped: number; problems: string[] } {
  const fees = new Map<string, number>();
  if (map.withdrawn >= 0 && map.linked >= 0) {
    for (const r of sheet.body) {
      const w = money(r[map.withdrawn]); const link = String(r[map.linked] ?? "").trim().toUpperCase();
      if (w > 0 && link) fees.set(link, (fees.get(link) ?? 0) + w);
    }
  }
  const rows: StatementRow[] = []; const problems: string[] = []; let skipped = 0;
  sheet.body.forEach((r, i) => {
    const amount = money(r[map.amount]);
    const status = map.status >= 0 ? String(r[map.status] ?? "").toLowerCase() : "completed";
    if (amount <= 0 || (status && !/complet|success/.test(status))) { skipped++; return; }
    const receipt = String(r[map.receipt] ?? "").trim().toUpperCase();
    const at = map.time >= 0 ? parseTime(r[map.time]) : null;
    if (!/^[A-Z0-9]{8,12}$/.test(receipt) || !at) { problems.push(`Line ${sheet.headerRow + i + 2}: ${!at ? "unreadable time" : "unreadable receipt"}`); return; }
    rows.push({
      receipt, completed_at: at, amount_kes: Math.round(amount * 100) / 100,
      ...(map.payer >= 0 && r[map.payer] ? { payer_hint: String(r[map.payer]).trim().slice(0, 60) } : {}),
      ...(map.account >= 0 && r[map.account] ? { account_ref: String(r[map.account]).trim().slice(0, 40) } : {}),
      ...(fees.has(receipt) ? { fee_kes: Math.round(fees.get(receipt)! * 100) / 100 } : {}),
    });
  });
  return { rows, skipped, problems };
}
