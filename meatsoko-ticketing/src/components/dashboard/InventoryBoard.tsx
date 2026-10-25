"use client";
import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/merchandise";
import { available, isLow, type InvGroup, type InvProduct, type InvVariant } from "@/lib/inventory";
import StockGrid from "@/components/dashboard/inventory/StockGrid";
import StockImport from "@/components/dashboard/inventory/StockImport";
import StockHistory from "@/components/dashboard/inventory/StockHistory";

// Dashboard → Inventory. Four quick ways to change stock, all writing to the one
// ledger (merch_stock_movements) through merch_stock_apply():
//   Stock-take  type what you counted; only the differences are saved
//   Receive     a delivery: units in, optional supplier, note number and cost
//   Remove      units out with a reason (damaged, giveaway, sample, …)
//   Import      the same from a spreadsheet (download the template, fill, upload)
// A size starts being tracked only with a confirmed opening count; until then it
// sells to order with no limit and sales of it move no stock.

export type BatchLine = { variant_id: string; counted: number | null; qty: number | null; expected_on_hand: number | null; unit_cost_kes: number | null; outcome: string; delta: number | null };
export type Batch = {
  id: string; batch_number: string; kind: string; status: string; supplier: string | null; reference: string | null;
  issue_reason: string | null; note: string | null; reverses_batch_id: string | null; created_by: string | null;
  created_at: string; confirmed_by: string | null; confirmed_at: string | null; merch_stock_batch_lines: BatchLine[];
};
export type Movement = {
  id: string; variant_id: string; delta: number; reason: string; balance: number; note: string | null; actor: string | null; created_at: string;
  merch_stock_batches: { batch_number: string } | null; merch_manual_sales: { sale_number: string } | null;
  merch_returns: { return_number: string } | null; merch_orders: { order_number: string } | null;
};
export type VariantInfo = { v: InvVariant; p: InvProduct; group: string };

type Tab = "stock" | "count" | "receive" | "remove" | "opening" | "import" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "stock", label: "Stock" }, { id: "count", label: "Stock-take" }, { id: "receive", label: "Receive" },
  { id: "remove", label: "Remove" }, { id: "opening", label: "Opening count" }, { id: "import", label: "Import" },
  { id: "history", label: "History" },
];

export default function InventoryBoard({ groups, batches, movements, people, ledgerProblems }: {
  groups: InvGroup[]; batches: Batch[]; movements: Movement[]; people: Record<string, string>; ledgerProblems: number | null;
}) {
  const [tab, setTab] = useState<Tab>("stock");
  const variants = useMemo(() => {
    const m = new Map<string, VariantInfo>();
    for (const g of groups) for (const p of g.products) for (const v of p.variants) m.set(v.id, { v, p, group: g.name });
    return m;
  }, [groups]);
  const all = Array.from(variants.values()).map((x) => x.v);
  const tracked = all.filter((v) => v.stock_on_hand != null);
  const drafts = batches.filter((b) => b.status === "draft");

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>Inventory</h1>
        <p>Stock for every product and size. Count, receive or remove stock below — every change is kept in the history with who made it and why. A size starts being counted once its opening count is confirmed; until then it sells to order with no limit.</p>
      </div>

      <div className="dash-stats">
        <div><span>Sizes tracked</span><strong>{tracked.length} / {all.length}</strong></div>
        <div><span>Units in stock</span><strong>{tracked.reduce((n, v) => n + (v.stock_on_hand ?? 0), 0).toLocaleString("en-KE")}</strong></div>
        <div className={tracked.some((v) => isLow(v) && v.stock_on_hand! > 0) ? "warn" : undefined}><span>Running low</span><strong>{tracked.filter((v) => isLow(v) && v.stock_on_hand! > 0).length}</strong></div>
        <div className={tracked.some((v) => v.stock_on_hand === 0) ? "warn" : undefined}><span>Sold out</span><strong>{tracked.filter((v) => v.stock_on_hand === 0).length}</strong></div>
        {drafts.length > 0 && <div className="warn"><span>Counts to confirm</span><strong>{drafts.length}</strong></div>}
      </div>

      <div className="dash-chips dash-tabs-row" role="tablist" aria-label="Inventory">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : undefined} onClick={() => setTab(t.id)}>
            {t.label}{t.id === "opening" && drafts.length > 0 ? ` (${drafts.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "stock" && <StockOverview groups={groups} ledgerProblems={ledgerProblems} />}
      {tab === "count" && <StockGrid key="count" mode="count" groups={groups} />}
      {tab === "receive" && <StockGrid key="receive" mode="receive" groups={groups} />}
      {tab === "remove" && <StockGrid key="remove" mode="issue" groups={groups} />}
      {tab === "opening" && <StockGrid key="opening" mode="opening" groups={groups} drafts={drafts} variants={variants} />}
      {tab === "import" && <StockImport variants={variants} />}
      {tab === "history" && <StockHistory batches={batches} movements={movements} variants={variants} people={people} />}
    </div>
  );
}

function StockOverview({ groups, ledgerProblems }: { groups: InvGroup[]; ledgerProblems: number | null }) {
  const [filter, setFilter] = useState<"all" | "low" | "untracked">("all");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const show = (v: InvVariant) =>
    filter === "low" ? v.stock_on_hand != null && isLow(v) : filter === "untracked" ? v.stock_on_hand == null : true;

  return (
    <>
      <div className="dash-toolbar">
        <div className="dash-chips">
          <button className={filter === "all" ? "on" : undefined} onClick={() => setFilter("all")}>All products</button>
          <button className={filter === "low" ? "on" : undefined} onClick={() => setFilter("low")}>Low or sold out</button>
          <button className={filter === "untracked" ? "on" : undefined} onClick={() => setFilter("untracked")}>Not tracked yet</button>
        </div>
        <input className="dash-search" type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
      </div>
      {ledgerProblems != null && (
        <p className={ledgerProblems ? "dash-error" : "dash-muted"}>
          {ledgerProblems ? `Ledger check: ${ledgerProblems} size(s) don't add up — tell the developer.` : "Ledger check: every count matches its history."}
        </p>
      )}
      {groups.map((g) => {
        const products = g.products.filter((p) => (!term || `${p.name} ${p.color}`.toLowerCase().includes(term)) && p.variants.some(show));
        if (!products.length) return null;
        return (
          <section key={g.id} className="dash-group">
            <h2>{g.name}</h2>
            <div className="dash-products">
              {products.map((p) => (
                <article key={p.id} className="dash-product">
                  <header>
                    <strong>{p.name}</strong>
                    <small>
                      {p.color} · {p.price_usd != null ? formatPrice(p.price_usd) : "No price"}
                      {p.sold_out ? " · shown sold out on the shop" : ""}{!p.is_active ? " · hidden from the shop" : ""}
                    </small>
                  </header>
                  <div className="dash-sizes">
                    {p.variants.filter(show).map((v) => {
                      const state = v.stock_on_hand == null ? "untracked" : v.stock_on_hand === 0 ? "out" : isLow(v) ? "low" : "ok";
                      return (
                        <div key={v.id} className={`dash-size dash-size-row ${state}`}>
                          <span className="dash-size-name">{v.size}</span>
                          <span className="dash-size-count">
                            {v.stock_on_hand == null ? "To order" : <><strong>{v.stock_on_hand}</strong> on hand</>}
                            {v.held > 0 && v.stock_on_hand != null && <small> · {v.held} held, {available(v)} free</small>}
                          </span>
                          <small className="dash-size-state">{state === "untracked" ? "Not tracked" : state === "out" ? "Sold out" : state === "low" ? "Low" : "In stock"}</small>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
