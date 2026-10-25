// Dashboard reports: one builder for both the CSV download (browser) and the
// printable page (server), so the two always show the same rows. Read with the
// admin's session — RLS and the admin-only functions decide what is visible.
// Reports carry no customer phone numbers, emails or buyer names.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BATCH_LABEL, REASON_LABEL, nairobiDay, nairobiStart } from "./inventory";

export type ReportType = "stock" | "movements" | "sales_lines" | "sales_summary" | "manual_sales" | "returns" | "received";
export type ReportFilters = {
  from: string; to: string;            // Nairobi days, YYYY-MM-DD, inclusive
  source: "" | "web" | "manual";
  groupId: string; productId: string;  // "" = all
  includeUntracked: boolean;           // stock report: sizes not counted yet
};
export type Cell = string | number;
export type ReportSection = { title?: string; columns: string[]; rows: Cell[][] };
export type Report = { title: string; subtitle: string; totals: { label: string; value: string }[]; sections: ReportSection[] };

export const REPORT_TYPES: { id: ReportType; label: string; blurb: string; dates: boolean; source: boolean; untracked: boolean }[] = [
  { id: "stock", label: "Current stock", blurb: "Every product and size: on hand, held by web checkouts, free.", dates: false, source: false, untracked: true },
  { id: "movements", label: "Stock movements", blurb: "Every stock change in the period: counts, deliveries, removals, sales, returns.", dates: true, source: false, untracked: false },
  { id: "sales_summary", label: "Sales summary", blurb: "Totals, by product, by day and by payment method.", dates: true, source: true, untracked: false },
  { id: "sales_lines", label: "Sales lines", blurb: "Every sale, return and refund line — website and manual.", dates: true, source: true, untracked: false },
  { id: "manual_sales", label: "Manual sales", blurb: "Sales recorded in the dashboard (event stand, office), with status.", dates: true, source: false, untracked: false },
  { id: "returns", label: "Returns & refunds", blurb: "Returns, refunds and exchanges, website and manual.", dates: true, source: true, untracked: false },
  { id: "received", label: "Stock received", blurb: "Deliveries with supplier, note number and cost.", dates: true, source: false, untracked: false },
];

const METHOD: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", other: "Other", paystack: "Paystack" };
const KIND: Record<string, string> = {
  sale: "Sale", return: "Return / refund", exchange_out: "Exchange out", delivery: "Delivery fee",
  delivery_refund: "Delivery refund", refund: "Refund (whole order)", exchange_topup: "Exchange top-up",
};
const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const at = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "");

function range(f: ReportFilters) {
  const a = nairobiStart(f.from), b = new Date(nairobiStart(f.to).getTime() + 864e5);
  return { a: a.toISOString(), b: b.toISOString(), label: f.from === f.to ? f.from : `${f.from} to ${f.to}` };
}

async function catalogue(db: SupabaseClient) {
  const { data, error } = await db.from("merch_products")
    .select("id,name,color,group_id,is_active,merch_groups(name),merch_variants(id,size,sku,stock_on_hand,is_active,is_bucket,position)")
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

export async function buildReport(db: SupabaseClient, type: ReportType, f: ReportFilters): Promise<Report> {
  const r = range(f);
  const meta = REPORT_TYPES.find((t) => t.id === type)!;
  const products = await catalogue(db);
  const productOk = (id: string | null | undefined) => {
    if (!f.groupId && !f.productId) return true;
    const p = products.find((x) => x.id === id);
    return !!p && (!f.productId || p.id === f.productId) && (!f.groupId || p.group_id === f.groupId);
  };
  const variantInfo = new Map<string, { p: any; v: any }>();
  for (const p of products) for (const v of p.merch_variants ?? []) variantInfo.set(v.id, { p, v });
  const scope = [
    f.productId ? `${products.find((p) => p.id === f.productId)?.name ?? ""} ${products.find((p) => p.id === f.productId)?.color ?? ""}`.trim()
      : f.groupId ? products.find((p) => p.group_id === f.groupId)?.merch_groups?.name : null,
    meta.source && f.source ? (f.source === "web" ? "Website only" : "Manual only") : null,
  ].filter(Boolean).join(" · ");
  const subtitle = [meta.dates ? r.label : `As of ${at(new Date().toISOString())}`, scope].filter(Boolean).join(" · ");
  const base = { title: meta.label, subtitle };

  if (type === "stock") {
    const { data: avail } = await db.rpc("merch_availability");
    const held = new Map<string, number>(((avail ?? []) as any[]).map((x) => [x.variant_id, Number(x.held ?? 0)]));
    const rows: Cell[][] = [];
    let units = 0, owed = 0, counted = 0;
    for (const p of products) {
      if (!productOk(p.id)) continue;
      const bucket = (p.merch_variants ?? []).find((v: any) => v.is_bucket && v.stock_on_hand != null);
      for (const v of [...(p.merch_variants ?? [])].sort((a: any, b: any) => a.position - b.position)) {
        const tracked = v.stock_on_hand != null;
        if (!tracked && !f.includeUntracked) continue;
        if (tracked) { counted++; units += Math.max(0, v.stock_on_hand); owed += Math.max(0, -v.stock_on_hand); }
        const h = held.get(v.id) ?? 0;
        rows.push([p.merch_groups?.name ?? "", p.name, p.color, v.is_bucket ? "Mixed sizes" : v.size, v.sku,
          tracked ? "Counted" : bucket ? "In mixed sizes" : "Not counted",
          tracked ? v.stock_on_hand : "", tracked ? h : "", tracked ? Math.max(0, v.stock_on_hand - h) : "",
          p.is_active && v.is_active ? "Yes" : "No"]);
      }
    }
    return { ...base, totals: [{ label: "Units on hand", value: units.toLocaleString("en-KE") }, { label: "Counted lines", value: String(counted) },
        ...(owed ? [{ label: "Sold online, not in stock", value: String(owed) }] : [])],
      sections: [{ columns: ["Category", "Product", "Colour", "Size", "SKU", "Status", "On hand", "Held", "Free", "On website"], rows }] };
  }

  if (type === "movements") {
    const { data, error } = await db.from("merch_stock_movements")
      .select("variant_id,delta,reason,balance,note,created_at,merch_stock_batches(batch_number),merch_manual_sales(sale_number),merch_returns(return_number),merch_orders(order_number)")
      .gte("created_at", r.a).lt("created_at", r.b).order("created_at").limit(10000);
    if (error) throw new Error(error.message);
    let inn = 0, out = 0;
    const rows = ((data ?? []) as any[]).filter((m) => productOk(variantInfo.get(m.variant_id)?.p.id)).map((m) => {
      const x = variantInfo.get(m.variant_id);
      if (m.delta > 0) inn += m.delta; else out -= m.delta;
      return [at(m.created_at), x?.v.sku ?? "", x?.p.name ?? "", x?.p.color ?? "", x?.v.is_bucket ? "Mixed sizes" : x?.v.size ?? "",
        m.reason === "opening" ? `= ${m.delta}` : m.delta, m.balance, REASON_LABEL[m.reason] ?? m.reason,
        m.merch_stock_batches?.batch_number ?? m.merch_manual_sales?.sale_number ?? m.merch_returns?.return_number ?? m.merch_orders?.order_number ?? "", m.note ?? ""] as Cell[];
    });
    return { ...base, totals: [{ label: "Changes", value: String(rows.length) }, { label: "Units in", value: String(inn) }, { label: "Units out", value: String(out) }],
      sections: [{ columns: ["When", "SKU", "Product", "Colour", "Size", "Change", "After", "What", "Reference", "Note"], rows }] };
  }

  if (type === "sales_lines" || type === "sales_summary") {
    const { data, error } = await db.rpc("merch_sales_lines", { p_from: r.a, p_to: r.b, p_source: f.source || null, p_product_id: f.productId || null });
    if (error) throw new Error(error.message);
    // Lines without a product (delivery fees, top-ups) count only when no product/category is chosen.
    const lines = ((data ?? []) as any[]).filter((l) => (l.product_id ? productOk(l.product_id) : !f.groupId && !f.productId));
    const net = lines.reduce((s, l) => s + Number(l.amount_kes), 0);
    const sold = lines.filter((l) => l.kind === "sale").reduce((s, l) => s + l.qty, 0);
    const refunds = -lines.filter((l) => ["return", "refund", "delivery_refund"].includes(l.kind)).reduce((s, l) => s + Number(l.amount_kes), 0);
    const totals = [{ label: "Net sales", value: ksh(net) }, { label: "Units sold", value: String(sold) }, { label: "Refunded", value: ksh(refunds) },
      { label: "Website orders · manual sales", value: `${new Set(lines.filter((l) => l.kind === "sale" && l.source === "web").map((l) => l.ref)).size} · ${new Set(lines.filter((l) => l.kind === "sale" && l.source === "manual").map((l) => l.ref)).size}` }];
    if (type === "sales_lines") {
      return { ...base, totals, sections: [{ columns: ["When", "Source", "Reference", "Kind", "SKU", "Product", "Colour", "Size", "Qty", "Amount KSh", "Paid with"],
        rows: lines.map((l) => [at(l.occurred_at), l.source === "web" ? "Website" : "Manual", l.ref, KIND[l.kind] ?? l.kind, l.sku ?? "", l.product_name,
          l.color ?? "", l.size ?? "", l.qty, Number(l.amount_kes), METHOD[l.payment_method] ?? l.payment_method ?? ""]) }] };
    }
    const byProduct = new Map<string, { name: string; color: string; sold: number; back: number; net: number }>();
    const byDay = new Map<string, { web: number; manual: number; units: number }>();
    const byMethod = new Map<string, number>();
    for (const l of lines) {
      if (l.product_id) {
        const p = byProduct.get(l.product_id) ?? { name: l.product_name, color: l.color ?? "", sold: 0, back: 0, net: 0 };
        if (l.kind === "sale" || l.kind === "exchange_out") p.sold += l.qty;
        if (l.kind === "return") p.back -= l.qty;
        p.net += Number(l.amount_kes); byProduct.set(l.product_id, p);
      }
      const day = nairobiDay(new Date(l.occurred_at));
      const d = byDay.get(day) ?? { web: 0, manual: 0, units: 0 };
      d[l.source === "web" ? "web" : "manual"] += Number(l.amount_kes);
      if (["sale", "return", "exchange_out"].includes(l.kind)) d.units += l.qty;
      byDay.set(day, d);
      const m = METHOD[l.payment_method] ?? "Other";
      byMethod.set(m, (byMethod.get(m) ?? 0) + Number(l.amount_kes));
    }
    return { ...base, totals, sections: [
      { title: "By product", columns: ["Product", "Colour", "Sold", "Returned", "Net KSh"],
        rows: Array.from(byProduct.values()).sort((a, b) => b.sold - a.sold || b.net - a.net).map((p) => [p.name, p.color, p.sold, p.back, Math.round(p.net * 100) / 100]) },
      { title: "By day", columns: ["Day", "Website KSh", "Manual KSh", "Units"],
        rows: Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => [day, Math.round(d.web * 100) / 100, Math.round(d.manual * 100) / 100, d.units]) },
      { title: "By payment method", columns: ["Paid with", "Net KSh"],
        rows: Array.from(byMethod.entries()).sort(([, a], [, b]) => b - a).map(([m, v]) => [m, Math.round(v * 100) / 100]) },
    ] };
  }

  if (type === "manual_sales") {
    const { data, error } = await db.from("merch_manual_sales")
      .select("sale_number,sold_at,payment_method,mpesa_code,location,subtotal_kes,refunded_kes,status,void_reason,merch_manual_sale_items(variant_id,product_name,size,qty)")
      .gte("sold_at", r.a).lt("sold_at", r.b).order("sold_at").limit(5000);
    if (error) throw new Error(error.message);
    const sales = ((data ?? []) as any[]).filter((s) => !f.groupId && !f.productId || s.merch_manual_sale_items.some((i: any) => productOk(variantInfo.get(i.variant_id)?.p.id)));
    const live = sales.filter((s) => s.status === "recorded");
    return { ...base,
      totals: [{ label: "Sales", value: String(live.length) }, { label: "Total", value: ksh(live.reduce((n, s) => n + Number(s.subtotal_kes), 0)) },
        { label: "Refunded", value: ksh(live.reduce((n, s) => n + Number(s.refunded_kes), 0)) }, { label: "Voided", value: String(sales.length - live.length) }],
      sections: [{ columns: ["Sale", "When", "Items", "Total KSh", "Refunded KSh", "Paid with", "M-Pesa code", "Where", "Status"],
        rows: sales.map((s) => [s.sale_number, at(s.sold_at), s.merch_manual_sale_items.map((i: any) => `${i.qty} x ${i.product_name} ${i.size}`).join("; "),
          Number(s.subtotal_kes), Number(s.refunded_kes), METHOD[s.payment_method] ?? s.payment_method, s.mpesa_code ?? "", s.location ?? "",
          s.status === "voided" ? `Voided: ${s.void_reason ?? ""}` : "Recorded"]) }] };
  }

  if (type === "returns") {
    let q = db.from("merch_returns")
      .select("return_number,created_at,source,reason,refund_kes,refund_method,refund_ref,extra_paid_kes,merch_orders(order_number),merch_manual_sales(sale_number),merch_return_lines(direction,variant_id,product_name,size,qty)")
      .gte("created_at", r.a).lt("created_at", r.b).order("created_at").limit(5000);
    if (f.source) q = q.eq("source", f.source);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rets = ((data ?? []) as any[]).filter((x) => !f.groupId && !f.productId || x.merch_return_lines.some((l: any) => productOk(variantInfo.get(l.variant_id)?.p.id)));
    const list = (x: any, dir: string) => x.merch_return_lines.filter((l: any) => l.direction === dir && l.qty > 0).map((l: any) => `${l.qty} x ${l.product_name} ${l.size}`).join("; ");
    return { ...base,
      totals: [{ label: "Returns", value: String(rets.length) }, { label: "Refunded", value: ksh(rets.reduce((n, x) => n + Number(x.refund_kes), 0)) },
        { label: "Exchange top-ups", value: ksh(rets.reduce((n, x) => n + Number(x.extra_paid_kes), 0)) }],
      sections: [{ columns: ["Return", "When", "Source", "Sale", "Reason", "Items back", "Exchanged out", "Refund KSh", "Refunded with", "Reference", "Top-up KSh"],
        rows: rets.map((x) => [x.return_number, at(x.created_at), x.source === "web" ? "Website" : "Manual", x.merch_orders?.order_number ?? x.merch_manual_sales?.sale_number ?? "",
          x.reason, list(x, "in"), list(x, "out"), Number(x.refund_kes), METHOD[x.refund_method] ?? x.refund_method ?? "", x.refund_ref ?? "", Number(x.extra_paid_kes)]) }] };
  }

  // received
  const { data, error } = await db.from("merch_stock_batches")
    .select("batch_number,kind,confirmed_at,supplier,reference,note,merch_stock_batch_lines(variant_id,qty,unit_cost_kes,outcome)")
    .eq("kind", "receive").eq("status", "confirmed").gte("confirmed_at", r.a).lt("confirmed_at", r.b).order("confirmed_at").limit(5000);
  if (error) throw new Error(error.message);
  let units = 0, cost = 0;
  const rows: Cell[][] = [];
  for (const b of (data ?? []) as any[]) for (const l of b.merch_stock_batch_lines) {
    const x = variantInfo.get(l.variant_id);
    if (l.outcome !== "applied" || !productOk(x?.p.id)) continue;
    const line = l.unit_cost_kes != null ? Number(l.unit_cost_kes) * l.qty : null;
    units += l.qty; cost += line ?? 0;
    rows.push([at(b.confirmed_at), b.batch_number, b.supplier ?? "", b.reference ?? "", x?.v.sku ?? "", x?.p.name ?? "", x?.p.color ?? "",
      x?.v.is_bucket ? "Mixed sizes" : x?.v.size ?? "", l.qty, l.unit_cost_kes != null ? Number(l.unit_cost_kes) : "", line ?? ""]);
  }
  return { ...base, totals: [{ label: "Units received", value: String(units) }, { label: "Cost recorded", value: ksh(cost) }, { label: BATCH_LABEL.receive + "s", value: String(new Set(rows.map((x) => x[1])).size) }],
    sections: [{ columns: ["When", "Delivery", "Supplier", "Note no.", "SKU", "Product", "Colour", "Size", "Qty", "Unit cost KSh", "Line cost KSh"], rows }] };
}

/** One CSV from a report: a heading row before each titled section. */
export function reportToCsv(r: Report): { head: string[]; rows: Cell[][] } {
  if (r.sections.length === 1) return { head: r.sections[0].columns, rows: r.sections[0].rows };
  const rows: Cell[][] = [];
  r.sections.forEach((s, i) => { if (i) rows.push([]); rows.push([s.title ?? ""]); rows.push(s.columns); rows.push(...s.rows); });
  return { head: [r.title, r.subtitle], rows };
}

export function filtersFromParams(p: Record<string, string | undefined>): ReportFilters {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const today = nairobiDay(new Date());
  return {
    from: p.from && day.test(p.from) ? p.from : nairobiDay(new Date(Date.now() - 29 * 864e5)),
    to: p.to && day.test(p.to) ? p.to : today,
    source: p.source === "web" || p.source === "manual" ? p.source : "",
    groupId: p.group ?? "", productId: p.product ?? "",
    includeUntracked: p.untracked === "1",
  };
}
