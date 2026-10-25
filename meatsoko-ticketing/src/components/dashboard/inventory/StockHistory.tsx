"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BATCH_LABEL, ISSUE_REASONS, REASON_LABEL, downloadCsv, explain, kes, when } from "@/lib/inventory";
import type { Batch, Movement, VariantInfo } from "@/components/dashboard/InventoryBoard";

// What changed, when, who and why. Batches are the admin's own actions (counts,
// deliveries, removals); movements are every stock change including sales and
// returns. A delivery, removal or stock-take entered by mistake is undone with a
// reversal batch — nothing is ever edited or deleted.

export default function StockHistory({ batches, movements, variants, people }: {
  batches: Batch[]; movements: Movement[]; variants: Map<string, VariantInfo>; people: Record<string, string>;
}) {
  const [view, setView] = useState<"batches" | "movements">("batches");
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const reversed = new Set(batches.map((b) => b.reverses_batch_id).filter(Boolean));
  const term = q.trim().toLowerCase();
  const label = (id: string) => { const x = variants.get(id); return x ? `${x.p.name} ${x.p.color} ${x.v.size}` : id; };
  const ref = (m: Movement) => m.merch_stock_batches?.batch_number ?? m.merch_manual_sales?.sale_number ?? m.merch_returns?.return_number ?? m.merch_orders?.order_number ?? "";

  const shownMoves = useMemo(() => movements.filter((m) =>
    (!reason || m.reason === reason) && (!term || `${label(m.variant_id)} ${variants.get(m.variant_id)?.v.sku ?? ""} ${ref(m)}`.toLowerCase().includes(term))),
  [movements, reason, term]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportStock() {
    downloadCsv("stock", ["SKU", "Category", "Product", "Colour", "Size", "Tracked", "On hand", "Held by web checkouts", "Available", "On paid orders not handed over"],
      Array.from(variants.values()).map(({ v, p, group }) => [v.sku, group, p.name, p.color, v.size, v.stock_on_hand == null ? "no" : "yes",
        v.stock_on_hand ?? "", v.held, v.stock_on_hand == null ? "" : Math.max(0, v.stock_on_hand - v.held), v.committed]));
  }
  function exportMoves() {
    downloadCsv("stock-movements", ["When", "SKU", "Product", "Colour", "Size", "Change", "Balance after", "Reason", "Reference", "By", "Note"],
      shownMoves.map((m) => { const x = variants.get(m.variant_id); return [m.created_at, x?.v.sku, x?.p.name, x?.p.color, x?.v.size, m.delta, m.balance,
        REASON_LABEL[m.reason] ?? m.reason, ref(m), m.actor ? people[m.actor] ?? "staff" : "system", m.note ?? ""]; }));
  }

  return (
    <div className="dash-stack">
      <div className="dash-toolbar">
        <div className="dash-chips">
          <button className={view === "batches" ? "on" : undefined} onClick={() => setView("batches")}>Counts &amp; deliveries</button>
          <button className={view === "movements" ? "on" : undefined} onClick={() => setView("movements")}>Every stock change</button>
        </div>
        <div className="dash-toolbar-right">
          <button type="button" className="dash-btn" onClick={exportStock}>Export current stock (CSV)</button>
          {view === "movements" && <button type="button" className="dash-btn" onClick={exportMoves} disabled={!shownMoves.length}>Export these changes (CSV)</button>}
        </div>
      </div>

      {view === "batches" ? (
        batches.length === 0 ? <p className="dash-empty">No stock counts or deliveries yet.</p> : (
          <ul className="dash-list">
            {batches.map((b) => <BatchRow key={b.id} b={b} reversed={reversed.has(b.id)} label={label} people={people} batches={batches} />)}
          </ul>
        )
      ) : (
        <>
          <div className="dash-toolbar">
            <select className="dash-select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Kind of change">
              <option value="">All kinds of change</option>
              {Object.entries(REASON_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            <input className="dash-search" type="search" placeholder="Product, SKU or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search changes" />
          </div>
          {shownMoves.length === 0 ? <p className="dash-empty">No stock changes match.</p> : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr><th>When</th><th>Product</th><th>Change</th><th>After</th><th>What</th><th>By</th></tr></thead>
                <tbody>
                  {shownMoves.slice(0, 400).map((m) => (
                    <tr key={m.id}>
                      <td>{when(m.created_at)}</td>
                      <td>{label(m.variant_id)}<small>{variants.get(m.variant_id)?.v.sku}</small></td>
                      <td className={m.delta < 0 ? "neg" : "pos"}>{m.reason === "opening" ? `= ${m.delta}` : `${m.delta > 0 ? "+" : ""}${m.delta}`}</td>
                      <td>{m.balance}</td>
                      <td>{REASON_LABEL[m.reason] ?? m.reason}<small>{[ref(m), m.note].filter(Boolean).join(" · ")}</small></td>
                      <td>{m.actor ? people[m.actor] ?? "staff" : "system"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownMoves.length > 400 && <p className="dash-muted">Showing the latest 400 — export for all {shownMoves.length}.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BatchRow({ b, reversed, label, people, batches }: {
  b: Batch; reversed: boolean; label: (id: string) => string; people: Record<string, string>; batches: Batch[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const applied = b.merch_stock_batch_lines.filter((l) => l.outcome === "applied");
  const units = applied.reduce((n, l) => n + Math.abs(l.delta ?? 0), 0);
  const cost = b.merch_stock_batch_lines.reduce((s, l) => s + (l.unit_cost_kes != null ? Number(l.unit_cost_kes) * (l.qty ?? 0) : 0), 0);
  const reverses = b.reverses_batch_id ? batches.find((x) => x.id === b.reverses_batch_id)?.batch_number : null;
  const canReverse = b.status === "confirmed" && ["count", "receive", "issue"].includes(b.kind) && !reversed;

  async function reverse() {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc("merch_stock_reverse", { p_batch_id: b.id, p_reason: why });
    setBusy(false);
    const out: any = data;
    if (error || out?.result !== "reversed") { setMsg(error?.message ?? explain(out?.result) + (out?.lines ? ` (${out.lines.map((l: any) => `${l.sku}: ${l.on_hand}`).join(", ")})` : "")); return; }
    router.refresh();
  }

  return (
    <li className={`dash-order${open ? " open" : ""}`}>
      <button type="button" className="dash-order-head stock-batch-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><strong>{b.batch_number}</strong><small>{when(b.confirmed_at ?? b.created_at)}</small></span>
        <span>
          {BATCH_LABEL[b.kind] ?? b.kind}{b.issue_reason ? ` · ${ISSUE_REASONS.find((r) => r.id === b.issue_reason)?.label ?? b.issue_reason}` : ""}
          <small>{[b.supplier, b.reference, reverses ? `undoes ${reverses}` : null, b.note].filter(Boolean).join(" · ") || "—"}</small>
        </span>
        <span className="dash-order-total">{b.status === "confirmed" ? `${applied.length} size(s) · ${units} unit(s)` : `${b.merch_stock_batch_lines.length} size(s)`}</span>
        <span className="dash-order-badges">
          <span className={`dash-badge batch-${b.status}`}>{b.status === "draft" ? "To confirm" : b.status === "discarded" ? "Discarded" : reversed ? "Reversed" : "Saved"}</span>
        </span>
      </button>
      {open && (
        <div className="dash-order-body">
          <p className="dash-muted">By {b.created_by ? people[b.created_by] ?? "staff" : "—"}{b.confirmed_by && b.confirmed_by !== b.created_by ? `, confirmed by ${people[b.confirmed_by] ?? "staff"}` : ""}{cost ? ` · cost ${kes(cost)}` : ""}</p>
          <table className="dash-table">
            <thead><tr><th>Product</th><th>{b.kind === "opening" || b.kind === "count" ? "Counted" : "Units"}</th><th>Change</th><th>Result</th></tr></thead>
            <tbody>
              {b.merch_stock_batch_lines.map((l) => (
                <tr key={l.variant_id}>
                  <td>{label(l.variant_id)}{l.unit_cost_kes != null && <small>{kes(l.unit_cost_kes)} each</small>}</td>
                  <td>{l.counted ?? l.qty ?? "—"}</td>
                  <td>{l.delta == null ? "—" : `${l.delta > 0 ? "+" : ""}${l.delta}`}</td>
                  <td>{l.outcome === "conflict" ? `Not saved — count changed (was ${l.expected_on_hand})` : l.outcome === "unchanged" ? "Already right" : l.outcome === "draft" ? "Draft" : "Saved"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canReverse && !undo && <div className="dash-actions"><button type="button" className="dash-btn ghost" onClick={() => setUndo(true)}>Entered by mistake? Reverse it</button></div>}
          {undo && (
            <div className="dash-refund">
              <p>Reversing puts every change in this batch back as it was, as a new entry in the history.</p>
              <label>Why<input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Entered twice" maxLength={500} /></label>
              <div className="dash-actions">
                <button type="button" className="dash-btn danger" disabled={busy || !why.trim()} onClick={reverse}>Reverse {b.batch_number}</button>
                <button type="button" className="dash-btn ghost" onClick={() => setUndo(false)}>Cancel</button>
              </div>
            </div>
          )}
          {msg && <p className="dash-error">{msg}</p>}
        </div>
      )}
    </li>
  );
}
