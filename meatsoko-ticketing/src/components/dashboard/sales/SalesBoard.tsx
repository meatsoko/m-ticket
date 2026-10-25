"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, explain, kes, nairobiDay, nairobiStart, when, type InvGroup } from "@/lib/inventory";
import { BestSellers, DailySalesChart, fillDays, type DayRow, type ProductRow } from "@/components/dashboard/sales/SalesCharts";
import ManualSaleForm from "@/components/dashboard/sales/ManualSaleForm";
import ReturnForm from "@/components/dashboard/ReturnForm";

// Dashboard → Sales. One report over every merchandise sale — website orders,
// manual sales (event stand, office) and their returns — from merch_report and
// merch_sales_lines, which net refunds against sales the same way for both.
// Below it, admins record manual sales and correct, void or return them.

export type ManualSale = {
  id: string; sale_number: string; sold_at: string; payment_method: string; mpesa_code: string | null; payment_ref: string | null;
  buyer_name: string | null; location: string | null; event_id: string | null; note: string | null;
  subtotal_kes: number; refunded_kes: number; status: "recorded" | "voided"; void_reason: string | null; voided_at: string | null;
  replaces_sale_id: string | null; created_by: string | null; created_at: string;
  merch_manual_sale_items: { id: string; variant_id: string; product_name: string; color: string; size: string; sku: string; qty: number; unit_price_kes: number; line_total_kes: number; stock_tracked: boolean }[];
  merch_returns: { id: string; return_number: string; created_at: string; reason: string; refund_kes: number; refund_method: string | null; extra_paid_kes: number;
    merch_return_lines: { direction: string; manual_sale_item_id: string | null; product_name: string; color: string; size: string; qty: number; refund_kes: number; stock_moved: boolean }[] }[];
};
type Report = {
  totals: { units_sold: number; units_returned: number; units_exchanged: number; gross_kes: number; delivery_kes: number; refunds_kes: number;
    topups_kes: number; net_kes: number; web_orders: number; manual_sales: number; untracked_units: number };
  by_day: DayRow[]; by_product: ProductRow[]; by_source: { source: string; net_kes: number; units_sold: number }[];
  by_method: { method: string; net_kes: number }[];
};
type SalesLine = { kind: string; source: string; ref: string; occurred_at: string; product_id: string | null; variant_id: string | null;
  product_name: string; color: string | null; size: string | null; sku: string | null; qty: number; amount_kes: number; payment_method: string | null; stock_tracked: boolean | null };

const KIND_LABEL: Record<string, string> = {
  sale: "Sale", return: "Return / refund", exchange_out: "Exchange out", delivery: "Delivery fee",
  delivery_refund: "Delivery refund", refund: "Refund (whole order)", exchange_topup: "Exchange top-up",
};
const METHOD_LABEL: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", other: "Other", paystack: "Paystack", unknown: "—" };
const PRESETS = [{ id: 7, label: "7 days" }, { id: 30, label: "30 days" }, { id: 90, label: "90 days" }];

export default function SalesBoard({ groups, fxRate, events, sales, people }: {
  groups: InvGroup[]; fxRate: number | null; events: { id: string; name: string }[]; sales: ManualSale[]; people: Record<string, string>;
}) {
  const today = nairobiDay(new Date());
  const [from, setFrom] = useState(nairobiDay(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(today);
  const [source, setSource] = useState("");
  const [product, setProduct] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ replacing: ManualSale | null } | null>(null);
  const products = useMemo(() => groups.flatMap((g) => g.products), [groups]);

  const range = useMemo(() => {
    const a = nairobiStart(from), b = new Date(nairobiStart(to).getTime() + 864e5);
    return b > a ? { a, b } : null;
  }, [from, to]);

  const load = useCallback(async () => {
    if (!range) { setError("The end date is before the start date."); return; }
    setLoading(true); setError("");
    const db = createClient();
    const args = { p_from: range.a.toISOString(), p_to: range.b.toISOString(), p_source: source || null, p_product_id: product || null };
    const [r, l] = await Promise.all([db.rpc("merch_report", args), db.rpc("merch_sales_lines", args)]);
    setLoading(false);
    const out: any = r.data;
    if (r.error || out?.result !== "ok") { setError(r.error?.message ?? explain(out?.result)); return; }
    if (l.error) { setError(l.error.message); return; }
    setReport(out); setLines((l.data ?? []) as SalesLine[]);
  }, [range, source, product]);
  useEffect(() => { load(); }, [load, sales]);

  const t = report?.totals;
  function preset(days: number) { setFrom(nairobiDay(new Date(Date.now() - (days - 1) * 864e5))); setTo(today); }
  function exportLines() {
    downloadCsv("merch-sales", ["When", "Source", "Reference", "Kind", "SKU", "Product", "Colour", "Size", "Qty", "Amount KSh", "Paid with", "Stock tracked"],
      lines.map((l) => [l.occurred_at, l.source === "web" ? "Website" : "Manual", l.ref, KIND_LABEL[l.kind] ?? l.kind, l.sku ?? "", l.product_name,
        l.color ?? "", l.size ?? "", l.qty, Number(l.amount_kes), METHOD_LABEL[l.payment_method ?? "unknown"] ?? l.payment_method, l.stock_tracked == null ? "" : l.stock_tracked ? "yes" : "no"]));
  }

  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title">
          <h1>Sales</h1>
          <p>Every merchandise sale in one place: website orders and sales recorded here (event stand, office), with refunds and returns taken off. Amounts are KSh.</p>
        </div>
        {!form && <button type="button" className="dash-btn primary" onClick={() => setForm({ replacing: null })}>+ Record a sale</button>}
      </div>

      {form && <ManualSaleForm key={form.replacing?.id ?? "new"} groups={groups} fxRate={fxRate} events={events} replacing={form.replacing} onDone={() => setForm(null)} />}

      <div className="dash-filters" role="group" aria-label="Filters">
        <div className="dash-chips">{PRESETS.map((p) => <button key={p.id} type="button" onClick={() => preset(p.id)} className={from === nairobiDay(new Date(Date.now() - (p.id - 1) * 864e5)) && to === today ? "on" : undefined}>{p.label}</button>)}</div>
        <label>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <label>Source<select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Website and manual</option><option value="web">Website</option><option value="manual">Manual &amp; stand</option></select></label>
        <label>Product<select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.color}</option>)}</select></label>
      </div>

      {error && <p className="dash-error">{error}</p>}
      {t && (
        <div className="dash-stats" aria-busy={loading}>
          <div><span>Net sales</span><strong>{kes(t.net_kes)}</strong></div>
          <div><span>Units sold</span><strong>{t.units_sold}</strong></div>
          <div><span>Website orders · manual sales</span><strong>{t.web_orders} · {t.manual_sales}</strong></div>
          <div className={Number(t.refunds_kes) ? "warn" : undefined}><span>Refunded</span><strong>{kes(t.refunds_kes)}</strong></div>
          <div><span>Units returned · exchanged</span><strong>{t.units_returned} · {t.units_exchanged}</strong></div>
        </div>
      )}
      {t && (Number(t.delivery_kes) > 0 || Number(t.topups_kes) > 0 || t.untracked_units > 0) && (
        <p className="dash-muted">
          Net includes {kes(t.delivery_kes)} website delivery fees{Number(t.topups_kes) ? ` and ${kes(t.topups_kes)} exchange top-ups` : ""}.
          {t.untracked_units > 0 ? ` ${t.untracked_units} unit(s) were sold before their size was tracked, so they didn't move stock.` : ""}
        </p>
      )}

      {report && range && (
        <div className="dash-grid">
          <DailySalesChart series={fillDays(report.by_day, range.a, range.b)} />
          <BestSellers rows={report.by_product} />
        </div>
      )}
      {report && report.by_method.length > 0 && (
        <p className="dash-muted">By payment: {report.by_method.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${kes(m.net_kes)}`).join(" · ")}</p>
      )}

      <section className="dash-card">
        <div className="dash-card-head">
          <h2>Sales lines ({lines.length})</h2>
          <button type="button" className="dash-btn" disabled={!lines.length} onClick={exportLines}>Export CSV</button>
        </div>
        {lines.length === 0 ? <p className="dash-muted">{loading ? "Loading…" : "No sales in this period."}</p> : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>When</th><th>Reference</th><th>What</th><th>Qty</th><th>KSh</th><th>Paid with</th></tr></thead>
              <tbody>
                {lines.slice(-300).reverse().map((l, i) => (
                  <tr key={`${l.ref}-${l.kind}-${l.variant_id}-${i}`}>
                    <td>{when(l.occurred_at)}</td>
                    <td>{l.ref}<small>{l.source === "web" ? "Website" : "Manual"}</small></td>
                    <td>{l.product_name}{l.size ? ` · ${l.size}` : ""}<small>{KIND_LABEL[l.kind] ?? l.kind}{l.color ? ` · ${l.color}` : ""}{l.stock_tracked === false && l.kind === "sale" ? " · before tracking" : ""}</small></td>
                    <td className={l.qty < 0 ? "neg" : undefined}>{l.qty || ""}</td>
                    <td className={Number(l.amount_kes) < 0 ? "neg" : undefined}>{kes(l.amount_kes)}</td>
                    <td>{METHOD_LABEL[l.payment_method ?? "unknown"] ?? l.payment_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length > 300 && <p className="dash-muted">Showing the latest 300 — export for all {lines.length}.</p>}
          </div>
        )}
      </section>

      <section className="dash-stack">
        <h2 className="dash-section-title">Manual sales</h2>
        {sales.length === 0 ? <p className="dash-empty">No manual sales yet. Use “Record a sale” for sales at the event stand or the office.</p> : (
          <ul className="dash-list">
            {sales.map((s) => <SaleRow key={s.id} s={s} groups={groups} people={people} sales={sales} onCorrect={() => { setForm({ replacing: s }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function SaleRow({ s, groups, people, sales, onCorrect }: { s: ManualSale; groups: InvGroup[]; people: Record<string, string>; sales: ManualSale[]; onCorrect: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"" | "void" | "return">("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const replaces = s.replaces_sale_id ? sales.find((x) => x.id === s.replaces_sale_id)?.sale_number : null;
  const replacedBy = sales.find((x) => x.replaces_sale_id === s.id)?.sale_number;
  const backIn = (itemId: string) => s.merch_returns.flatMap((r) => r.merch_return_lines).filter((l) => l.direction === "in" && l.manual_sale_item_id === itemId);
  const items = s.merch_manual_sale_items.map((i) => ({
    id: i.id, name: i.product_name, color: i.color, size: i.size, qty: i.qty, unit_kes: Number(i.unit_price_kes), line_total: Number(i.line_total_kes),
    returned: backIn(i.id).reduce((n, l) => n + l.qty, 0), refunded: backIn(i.id).reduce((n, l) => n + Number(l.refund_kes), 0),
  }));
  const units = s.merch_manual_sale_items.reduce((n, i) => n + i.qty, 0);

  async function voidSale() {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc("merch_void_manual_sale", { p_sale_id: s.id, p_reason: why });
    setBusy(false);
    const out: any = data;
    if (error || out?.result !== "voided") { setMsg(error?.message ?? explain(out?.result)); return; }
    router.refresh();
  }

  return (
    <li className={`dash-order${open ? " open" : ""}`}>
      <button type="button" className="dash-order-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><strong>{s.sale_number}</strong><small>{when(s.sold_at)}</small></span>
        <span className="dash-order-who">{s.merch_manual_sale_items.map((i) => `${i.qty} × ${i.product_name} ${i.size}`).join(", ")}<small>{[s.location, s.buyer_name].filter(Boolean).join(" · ") || `${units} item(s)`}</small></span>
        <span className="dash-order-total"><strong>{kes(s.subtotal_kes)}</strong><small>{METHOD_LABEL[s.payment_method]}{s.mpesa_code ? ` · ${s.mpesa_code}` : ""}</small></span>
        <span className="dash-order-badges">
          {s.status === "voided" ? <span className="dash-badge pay-refunded">Voided</span>
            : Number(s.refunded_kes) >= Number(s.subtotal_kes) ? <span className="dash-badge pay-refunded">Refunded</span>
            : Number(s.refunded_kes) > 0 ? <span className="dash-badge pay-flagged">Part refunded</span>
            : <span className="dash-badge ful-collected">Sold</span>}
        </span>
      </button>
      {open && (
        <div className="dash-order-body">
          <div className="dash-order-grid">
            <div>
              <h3>Items</h3>
              <ul className="dash-items">
                {s.merch_manual_sale_items.map((i) => (
                  <li key={i.id}><span>{i.qty} × {i.product_name} <small>{i.color} · {i.size}{i.stock_tracked ? "" : " · before tracking"}</small></span><span>{kes(i.line_total_kes)}</span></li>
                ))}
              </ul>
              {s.merch_returns.length > 0 && (<>
                <h3>Returns</h3>
                <ul className="dash-items">
                  {s.merch_returns.map((r) => (
                    <li key={r.id}><span>{r.return_number} · {when(r.created_at)} <small>{r.reason}{r.merch_return_lines.some((l) => l.direction === "out") ? " · exchange" : ""}</small></span><span>−{kes(r.refund_kes)}</span></li>
                  ))}
                </ul>
              </>)}
            </div>
            <div>
              <h3>Details</h3>
              <p>Recorded by {s.created_by ? people[s.created_by] ?? "staff" : "—"}, {when(s.created_at)}</p>
              {s.payment_ref && <p>Reference: {s.payment_ref}</p>}
              {s.note && <p className="dash-note">{s.note}</p>}
              {replaces && <p>Corrects {replaces}</p>}
              {s.status === "voided" && <p className="dash-note">Voided {when(s.voided_at)}: {s.void_reason}{replacedBy ? ` — replaced by ${replacedBy}` : ""}</p>}
            </div>
          </div>
          {s.status === "recorded" && !mode && (
            <div className="dash-actions">
              <button type="button" className="dash-btn" onClick={() => setMode("return")}>Return, refund or exchange</button>
              {s.merch_returns.length === 0 && <button type="button" className="dash-btn ghost" onClick={onCorrect}>Correct this sale</button>}
              {s.merch_returns.length === 0 && <button type="button" className="dash-btn ghost" onClick={() => setMode("void")}>Void</button>}
            </div>
          )}
          {mode === "void" && (
            <div className="dash-refund">
              <p>Voiding removes the sale from reports and puts its tracked units back in stock. Use it only for a sale that didn&apos;t happen — for a returned item, record a return.</p>
              <label>Why<input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="e.g. Entered twice" /></label>
              <div className="dash-actions">
                <button type="button" className="dash-btn danger" disabled={busy || !why.trim()} onClick={voidSale}>Void {s.sale_number}</button>
                <button type="button" className="dash-btn ghost" onClick={() => setMode("")}>Cancel</button>
              </div>
              {msg && <p className="dash-error">{msg}</p>}
            </div>
          )}
          {mode === "return" && (
            <ReturnForm source="manual" saleId={s.id} items={items} refundable={Number(s.subtotal_kes) - Number(s.refunded_kes)}
              defaultMethod={s.payment_method === "mpesa" ? "mpesa" : "cash"} groups={groups} onDone={() => setMode("")} />
          )}
        </div>
      )}
    </li>
  );
}
