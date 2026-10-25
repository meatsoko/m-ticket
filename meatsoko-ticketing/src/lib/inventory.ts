// Shared by the dashboard's Inventory and Sales pages (migration
// 20261025100000_merch_inventory.sql). Every write goes through a SECURITY DEFINER
// function that checks is_admin(); these are display helpers and the words for
// each result code.

export type InvVariant = {
  id: string; size: string; sku: string; position: number; is_active: boolean;
  stock_on_hand: number | null; low_stock_at: number | null;
  /** Units held by web checkouts still being paid (30-minute hold). */
  held: number;
  /** Units on paid website orders not yet handed over. */
  committed: number;
};
export type InvProduct = {
  id: string; name: string; color: string; slug: string; position: number;
  price_usd: number | null; is_active: boolean; sold_out: boolean; variants: InvVariant[];
};
export type InvGroup = { id: string; name: string; position: number; products: InvProduct[] };

export const DEFAULT_LOW = 3;
export const isLow = (v: InvVariant) => v.stock_on_hand != null && v.stock_on_hand <= (v.low_stock_at ?? DEFAULT_LOW);
export const available = (v: InvVariant) => (v.stock_on_hand == null ? null : Math.max(0, v.stock_on_hand - v.held));

export const kes = (n: number | string | null | undefined) =>
  `KSh ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
export const when = (iso: string | null | undefined) => iso
  ? new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
  : "—";

/** A day in Nairobi as YYYY-MM-DD, and the UTC instant that day starts. */
export const nairobiDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const nairobiStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

export const ISSUE_REASONS: { id: string; label: string }[] = [
  { id: "damaged", label: "Damaged" }, { id: "giveaway", label: "Giveaway" }, { id: "sample", label: "Sample" },
  { id: "staff_use", label: "Staff use" }, { id: "lost", label: "Lost / missing" }, { id: "other", label: "Other (say why)" },
];
export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash" }, { id: "mpesa", label: "M-Pesa" }, { id: "card", label: "Card" }, { id: "other", label: "Other" },
] as const;

export const REASON_LABEL: Record<string, string> = {
  opening: "Opening count", restock: "Received", adjustment: "Stock-take", damaged: "Damaged", issue: "Removed",
  sale: "Website sale", manual_sale: "Manual sale", manual_sale_void: "Sale voided", return: "Returned",
  exchange_out: "Exchange", reversal: "Reversal",
};
export const BATCH_LABEL: Record<string, string> = {
  opening: "Opening count", count: "Stock-take", receive: "Delivery", issue: "Removal", reversal: "Reversal",
};

const RESULT_TEXT: Record<string, string> = {
  forbidden: "Only admins can do that.",
  bad_lines: "Check the quantities — whole numbers, each size once.",
  bad_kind: "Unknown kind of stock change.",
  untracked: "Some sizes aren't tracked yet — confirm an opening count for them first.",
  already_tracked: "Some sizes are already tracked — use a stock-take for them.",
  issue_reason_required: "Choose why the stock is being removed.",
  note_required: "Add a note saying why.",
  insufficient: "Not enough in stock (web checkouts being paid are held).",
  nothing_to_apply: "Nothing changed — the counts already match.",
  draft_opening_only: "Only opening counts can be saved as drafts.",
  not_draft: "That count was already confirmed or discarded — refresh.",
  not_reversible: "Opening counts can't be reversed — correct them with a stock-take.",
  already_reversed: "Already reversed.",
  reason_required: "Add a reason.",
  too_long: "A field is too long.",
  unknown_variant: "A size no longer exists — refresh.",
  bad_payment_method: "Choose how it was paid.",
  mpesa_code_required: "Enter the 10-character M-Pesa code.",
  mpesa_code_used: "That M-Pesa code is already on another sale.",
  bad_sold_at: "The sale date must be within the last 90 days and not in the future.",
  unknown_event: "Unknown event.",
  already_voided: "That sale was already voided — refresh.",
  has_returns: "This sale has returns recorded — record a return instead of voiding it.",
  void_reason_required: "Say why the original sale is being corrected.",
  not_found: "Not found — refresh.",
  not_returnable: "This sale can't take returns (not paid, already fully refunded, or voided).",
  exceeds_sold: "More than is left to return or refund on that item.",
  exceeds_delivery: "More than the delivery fee left to refund.",
  exceeds_total: "More than is left to refund on this sale.",
  refund_method_required: "Choose how the money was refunded.",
  extra_method_required: "Choose how the top-up was paid.",
  bad_source: "Unknown sale.",
  bad_request: "Something in the form couldn't be read.",
  bad_range: "Choose a valid date range (up to 400 days).",
};
export const explain = (result?: string | null) => (result && RESULT_TEXT[result]) || `Not saved (${result ?? "unknown"}).`;

/**
 * CSV for a spreadsheet: every cell quoted; a leading =,+,-,@ is neutralised so it
 * never runs as a formula — except a plain number, so "-2" stays a number.
 */
export function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    const risky = /^[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t);
    return `"${(risky ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [head.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `meatsoko-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
