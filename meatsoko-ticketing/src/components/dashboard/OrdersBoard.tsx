"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/merchandise";

export type DashOrder = {
  id: string; order_number: string; created_at: string; paid_at: string | null;
  first_name: string; last_name: string; phone: string; email: string;
  delivery_code: string; delivery_address: string | null; delivery_town: string | null;
  delivery_sacco: string | null; notes: string | null;
  total_usd: number; total_kes: number;
  payment_status: "pending" | "paid" | "failed" | "refunded" | "flagged";
  fulfilment_status: string; refund_reason: string | null;
  merch_delivery_options: { label: string } | null;
  merch_delivery_zones: { name: string } | null;
  merch_order_items: { product_name: string; color: string; size: string; qty: number; unit_price_usd: number }[];
};

const DONE = ["delivered", "collected", "cancelled"];
const PICKUP = ["event", "pickup"];
const STATUS_LABEL: Record<string, string> = {
  unfulfilled: "New", packed: "Packed", ready_for_pickup: "Ready for pickup", dispatched: "Dispatched",
  delivered: "Delivered", collected: "Collected", cancelled: "Cancelled",
};
// The order's own path: collection orders are "ready", delivery orders are "dispatched".
const stepsFor = (code: string) => PICKUP.includes(code)
  ? ["unfulfilled", "packed", "ready_for_pickup", "collected"]
  : ["unfulfilled", "packed", "dispatched", "delivered"];

type Filter = "todo" | "done" | "refunded" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "todo", label: "To fulfil" }, { id: "done", label: "Completed" },
  { id: "refunded", label: "Refunded" }, { id: "all", label: "All orders" },
];

const kes = (n: number) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", {
  timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));
const localPhone = (p: string) => p.startsWith("254") ? `0${p.slice(3)}` : p;

export default function OrdersBoard({ orders }: { orders: DashOrder[] }) {
  const [filter, setFilter] = useState<Filter>("todo");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const paid = orders.filter((o) => o.payment_status === "paid");
  const todo = paid.filter((o) => !DONE.includes(o.fulfilment_status));
  const revenue = paid.reduce((s, o) => s + Number(o.total_kes), 0);
  const flagged = orders.filter((o) => o.payment_status === "flagged").length;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "todo" && !(o.payment_status === "paid" && !DONE.includes(o.fulfilment_status)) && o.payment_status !== "flagged") return false;
      if (filter === "done" && !(o.payment_status === "paid" && DONE.includes(o.fulfilment_status))) return false;
      if (filter === "refunded" && o.payment_status !== "refunded") return false;
      if (!term) return true;
      return [o.order_number, o.first_name, o.last_name, o.phone, localPhone(o.phone), o.email]
        .some((v) => v?.toLowerCase().includes(term));
    });
  }, [orders, filter, q]);

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>Orders</h1>
        <p>Merchandise orders. Pending and failed payments appear under “All orders”.</p>
      </div>

      <div className="dash-stats">
        <div><span>To fulfil</span><strong>{todo.length}</strong></div>
        <div><span>Paid orders</span><strong>{paid.length}</strong></div>
        <div><span>Revenue (paid)</span><strong>{kes(revenue)}</strong></div>
        <div className={flagged ? "warn" : undefined}><span>Need a look</span><strong>{flagged}</strong></div>
      </div>

      <div className="dash-toolbar">
        <div className="dash-chips" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : undefined}
              onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="dash-toolbar-right">
          <input className="dash-search" type="search" placeholder="Search order, name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="dash-btn primary" onClick={() => exportCsv(shown)} disabled={!shown.length}>Export CSV</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="dash-empty">No orders here yet.</div>
      ) : (
        <ul className="dash-list">
          {shown.map((o) => (
            <OrderRow key={o.id} order={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

// The orders currently shown (filter + search), for a spreadsheet. Built in the
// browser from data the admin can already see; nothing is sent anywhere.
function exportCsv(rows: DashOrder[]) {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    // Quote everything; neutralise leading =,+,-,@ so a spreadsheet never runs it as a formula.
    return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const head = ["Order", "Placed", "Paid", "First name", "Last name", "Phone", "Email", "Items", "Delivery", "Area / address / town", "Total USD", "Total KSh", "Payment", "Fulfilment", "Notes"];
  const lines = rows.map((o) => [
    o.order_number, o.created_at, o.paid_at ?? "", o.first_name, o.last_name, localPhone(o.phone), o.email,
    o.merch_order_items.map((i) => `${i.qty} x ${i.product_name} (${i.color}, ${i.size})`).join("; "),
    o.merch_delivery_options?.label ?? o.delivery_code,
    [o.merch_delivery_zones?.name, o.delivery_address, o.delivery_town, o.delivery_sacco].filter(Boolean).join(" · "),
    o.total_usd, o.total_kes, o.payment_status, STATUS_LABEL[o.fulfilment_status] ?? o.fulfilment_status, o.notes ?? "",
  ].map(cell).join(","));
  const blob = new Blob([[head.map(cell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `meatsoko-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function OrderRow({ order: o, open, onToggle }: { order: DashOrder; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [restock, setRestock] = useState(true);

  const steps = stepsFor(o.delivery_code);
  const at = steps.indexOf(o.fulfilment_status);
  const next = o.payment_status === "paid" && at >= 0 && at < steps.length - 1 ? steps[at + 1] : null;
  const items = o.merch_order_items.reduce((n, i) => n + i.qty, 0);
  const where = [o.merch_delivery_zones?.name, o.delivery_address, o.delivery_town, o.delivery_sacco && `Sacco: ${o.delivery_sacco}`]
    .filter(Boolean).join(" · ");

  async function setStatus(status: string) {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("merch_set_fulfilment", { p_order_id: o.id, p_status: status });
    setBusy(false);
    if (error || (data as any)?.result !== "updated") { setMsg(error?.message ?? `Not updated (${(data as any)?.result})`); return; }
    router.refresh();
  }

  async function recordRefund() {
    if (!reason.trim()) { setMsg("Give a reason for the refund."); return; }
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("merch_refund_order", {
      p_order_id: o.id, p_reason: reason.trim(), p_restock: restock, p_refund_ref: ref.trim() || null,
    });
    setBusy(false);
    if (error || (data as any)?.result !== "refunded") { setMsg(error?.message ?? `Not recorded (${(data as any)?.result})`); return; }
    setRefunding(false);
    router.refresh();
  }

  const pay = o.payment_status;
  return (
    <li className={`dash-order${open ? " open" : ""}`}>
      <button type="button" className="dash-order-head" onClick={onToggle} aria-expanded={open}>
        <span className="dash-order-id"><strong>{o.order_number}</strong><small>{when(o.created_at)}</small></span>
        <span className="dash-order-who"><strong>{o.first_name} {o.last_name}</strong><small>{items} item{items === 1 ? "" : "s"} · {o.merch_delivery_options?.label ?? o.delivery_code}</small></span>
        <span className="dash-order-total"><strong>{formatPrice(Number(o.total_usd))}</strong><small>{kes(o.total_kes)}</small></span>
        <span className="dash-order-badges">
          {pay !== "paid" && <span className={`dash-badge pay-${pay}`}>{pay === "flagged" ? "Needs a look" : pay[0].toUpperCase() + pay.slice(1)}</span>}
          {pay === "paid" && <span className={`dash-badge ful-${o.fulfilment_status}`}>{STATUS_LABEL[o.fulfilment_status] ?? o.fulfilment_status}</span>}
        </span>
      </button>

      {open && (
        <div className="dash-order-body">
          <div className="dash-order-grid">
            <section>
              <h3>Items</h3>
              <ul className="dash-items">
                {o.merch_order_items.map((i, n) => (
                  <li key={n}><span>{i.qty} × {i.product_name} <small>{i.color} · {i.size}</small></span><span>{formatPrice(i.unit_price_usd * i.qty)}</span></li>
                ))}
              </ul>
            </section>
            <section>
              <h3>Customer</h3>
              <p><a href={`tel:+${o.phone}`}>{localPhone(o.phone)}</a> · <a href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></p>
              <p><a href={`mailto:${o.email}`}>{o.email}</a></p>
              <h3>{o.merch_delivery_options?.label ?? "Delivery"}</h3>
              <p>{where || "—"}</p>
              {o.notes && <p className="dash-note">“{o.notes}”</p>}
              {o.refund_reason && <p className="dash-note">Refunded: {o.refund_reason}</p>}
            </section>
          </div>

          {pay === "paid" && (
            <div className="dash-actions">
              {next && <button type="button" className="dash-btn primary" disabled={busy} onClick={() => setStatus(next)}>Mark {STATUS_LABEL[next].toLowerCase()}</button>}
              <label className="dash-inline">Status
                <select value={o.fulfilment_status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
                  {steps.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              {!refunding && <button type="button" className="dash-btn ghost" onClick={() => setRefunding(true)}>Record a refund</button>}
            </div>
          )}
          {pay === "flagged" && !refunding && (
            <div className="dash-actions">
              <p className="dash-note">Paid, but something didn&apos;t match (usually the amount). Check it in Paystack, then refund or contact the customer.</p>
              <button type="button" className="dash-btn ghost" onClick={() => setRefunding(true)}>Record a refund</button>
            </div>
          )}

          {refunding && (
            <div className="dash-refund">
              <p>First refund the payment in the <a href="https://dashboard.paystack.com/#/transactions" target="_blank" rel="noopener noreferrer">Paystack dashboard</a>, then record it here.</p>
              <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong size, customer returned it" /></label>
              <label>Paystack refund reference<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" /></label>
              {pay === "paid" && <label className="dash-check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock</label>}
              <div className="dash-actions">
                <button type="button" className="dash-btn danger" disabled={busy} onClick={recordRefund}>Record refund</button>
                <button type="button" className="dash-btn ghost" onClick={() => setRefunding(false)}>Cancel</button>
              </div>
            </div>
          )}
          {msg && <p className="dash-error">{msg}</p>}
        </div>
      )}
    </li>
  );
}
