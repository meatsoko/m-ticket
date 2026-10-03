"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  kes, localPhone, methodLabel, netCollected, ORDER_STATUS, orderError, paidTowards, PAYMENT_STATUS, when,
  type EventOrder, type MenuItem, type OrderPayment, type PaymentStatus,
} from "@/lib/event-orders";

type Tab = "overview" | "orders" | "menu";
type Staff = { user_id: string; email: string; role: string };

// Event Orders for management: totals, every order, per-staff accountability,
// admin corrections (cancel / refund / correction — always new records) and the
// on-site menu. Orders are taken on staff phones at /orders.
export default function EventOrdersBoard({ events, event, orders, menu, staff }: {
  events: { id: string; name: string; status: string }[]; event: { id: string; name: string };
  orders: EventOrder[]; menu: MenuItem[]; staff: Staff[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const name = (id: string | null) => (id ? staff.find((s) => s.user_id === id)?.email ?? "Former staff" : "—");

  // ---------- totals ----------
  const live = orders.filter((o) => o.order_status !== "cancelled");
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const kpi = {
    orders: live.length,
    sales: sum(live.map((o) => Number(o.total_kes))),
    collected: sum(orders.map(netCollected)),
    outstanding: sum(orders.map((o) => Number(o.event_order_balance))),
    refunded: sum(orders.map((o) => Number(o.refunded_kes))),
    paid: live.filter((o) => o.payment_status === "paid").length,
    partial: live.filter((o) => o.payment_status === "partially_paid").length,
    unpaid: live.filter((o) => o.payment_status === "unpaid").length,
    fulfilled: orders.filter((o) => o.order_status === "fulfilled").length,
    cancelled: orders.length - live.length,
  };

  // ---------- staff report ----------
  const report = useMemo(() => {
    const all: OrderPayment[] = orders.flatMap((o) => o.event_order_payments ?? []);
    const byId = new Map(all.map((p) => [p.id, p]));
    const ids = new Set<string>([...orders.map((o) => o.created_by), ...all.filter((p) => p.kind === "payment").map((p) => p.recorded_by)]);
    return Array.from(ids).map((uid) => {
      const own = orders.filter((o) => o.created_by === uid);
      const pays = all.filter((p) => p.kind === "payment" && p.recorded_by === uid);
      // A correction strikes off money that was never really received: it counts against the collector.
      const corrected = sum(all.filter((p) => p.kind === "correction" && byId.get(p.reverses_payment_id ?? "")?.recorded_by === uid).map((p) => Number(p.amount_kes)));
      return {
        uid, orders: own.length,
        value: sum(own.filter((o) => o.order_status !== "cancelled").map((o) => Number(o.total_kes))),
        payments: pays.length,
        collected: sum(pays.map((p) => Number(p.amount_kes))) - corrected,
        outstanding: sum(own.map((o) => Number(o.event_order_balance))),
        fulfilled: own.filter((o) => o.order_status === "fulfilled").length,
      };
    }).sort((a, b) => b.value - a.value);
  }, [orders]);

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>Event orders</h1>
        <p>On-site orders taken on staff phones (<a href="/orders">/orders</a>): payments, balances and who did what.</p>
      </div>
      <div className="dash-card-head">
        <select className="dash-select" aria-label="Event" value={event.id} onChange={(e) => router.push(`/dashboard/event-orders?event=${e.target.value}`)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === "closed" ? " (closed)" : ""}</option>)}
        </select>
        <div className="dash-chips" role="tablist" aria-label="Event orders sections">
          {(["overview", "orders", "menu"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : undefined} onClick={() => setTab(t)}>
              {t === "overview" ? "Overview" : t === "orders" ? `Orders ${orders.length}` : `Menu ${menu.filter((m) => m.is_active).length}`}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <>
          <div className="dash-kpis">
            <Kpi label="Orders" value={String(kpi.orders)} note={kpi.cancelled ? `${kpi.cancelled} cancelled, not counted` : "excluding cancelled"} />
            <Kpi label="Sales" value={kes(kpi.sales)} note="value of orders taken" />
            <Kpi label="Collected" value={kes(kpi.collected)} note={kpi.refunded ? `after ${kes(kpi.refunded)} refunded` : "payments recorded"} />
            <Kpi label="Outstanding" value={kes(kpi.outstanding)} note="balances still due" warn={kpi.outstanding > 0} />
          </div>
          <div className="dash-kpis">
            <Kpi label="Paid" value={String(kpi.paid)} note="fully paid orders" />
            <Kpi label="Part paid" value={String(kpi.partial)} note="balance remaining" />
            <Kpi label="Unpaid" value={String(kpi.unpaid)} note="nothing received yet" warn={kpi.unpaid > 0} />
            <Kpi label="Handed over" value={String(kpi.fulfilled)} note="fulfilled orders" />
          </div>
          <div className="dash-card">
            <h2>Staff</h2>
            {report.length === 0 ? <div className="dash-empty">No orders yet.</div> : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Staff member</th><th>Orders</th><th>Order value</th><th>Payments</th><th>Collected</th><th>Outstanding on their orders</th><th>Handed over</th></tr></thead>
                  <tbody>
                    {report.map((r) => (
                      <tr key={r.uid}>
                        <td><strong>{name(r.uid)}</strong></td>
                        <td>{r.orders}</td><td>{kes(r.value)}</td><td>{r.payments}</td><td>{kes(r.collected)}</td>
                        <td className={r.outstanding > 0 ? "eo-dash-due" : undefined}>{kes(r.outstanding)}</td><td>{r.fulfilled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="dash-muted">Collected = payments the person recorded (on anyone&apos;s order), less any corrections to them. Outstanding = balances on orders they took.</p>
          </div>
        </>
      )}

      {tab === "orders" && <OrdersTable orders={orders} name={name} eventName={event.name} onChanged={() => router.refresh()} />}
      {tab === "menu" && <MenuEditor eventId={event.id} menu={menu} onChanged={() => router.refresh()} />}
    </div>
  );
}

function Kpi({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className={`dash-kpi${warn ? " warn" : ""}`}>
      <span className="dash-kpi-label">{label}</span>
      <div className="dash-kpi-row"><strong>{value}</strong></div>
      <small>{note}</small>
    </div>
  );
}

// ---------------------------------------------------------------- orders table
function OrdersTable({ orders, name, eventName, onChanged }: {
  orders: EventOrder[]; name: (id: string | null) => string; eventName: string; onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | PaymentStatus>("all");
  const [open, setOpen] = useState<string | null>(null);

  const shown = orders.filter((o) => {
    if (status !== "all" && o.payment_status !== status) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const d = t.replace(/\D/g, "");
    return o.order_number.toLowerCase().includes(t) || o.customer_name.toLowerCase().includes(t)
      || (d.length >= 3 && (o.customer_phone.includes(d) || localPhone(o.customer_phone).includes(d)))
      || (o.event_order_payments ?? []).some((p) => (p.reference ?? "").toLowerCase().includes(t));
  });

  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Order", "Event", "Customer", "Phone", "Email", "Items", "Total KSh", "Paid KSh", "Refunded KSh", "Balance KSh", "Payment status", "Order status", "Created by", "Created", "Payments"];
    const body = shown.map((o) => [o.order_number, eventName, o.customer_name, localPhone(o.customer_phone), o.customer_email ?? "",
      (o.event_order_items ?? []).map((i) => `${i.qty}x ${i.name}`).join("; "), o.total_kes, paidTowards(o), o.refunded_kes, o.event_order_balance,
      PAYMENT_STATUS[o.payment_status].label, ORDER_STATUS[o.order_status].label, name(o.created_by), o.created_at,
      (o.event_order_payments ?? []).map((p) => `${p.kind} ${p.amount_kes} ${p.method}${p.reference ? ` ${p.reference}` : ""} by ${name(p.recorded_by)}`).join("; ")].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `meatsoko-event-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const count = (s: PaymentStatus) => orders.filter((o) => o.payment_status === s).length;
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-chips">
          {(["all", "unpaid", "partially_paid", "paid", "partially_refunded", "refunded"] as const).map((s) => (
            <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : PAYMENT_STATUS[s].label} <span className="dash-chip-count">{s === "all" ? orders.length : count(s)}</span>
            </button>
          ))}
        </div>
        <div className="dash-toolbar-right">
          <input className="dash-search" type="search" placeholder="Order no., customer, phone, payment ref" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
        </div>
      </div>
      {shown.length === 0 ? <div className="dash-empty">No orders{orders.length ? " match" : " yet"}.</div> : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Payment</th><th>Order</th><th>Created by</th><th>When</th></tr></thead>
            <tbody>
              {shown.map((o) => (
                <Fragment key={o.id}>
                  <tr className="eo-dash-row" onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={open === o.id}>
                    <td><button type="button" className="eo-dash-link" onClick={(e) => { e.stopPropagation(); setOpen(open === o.id ? null : o.id); }}>{o.order_number}</button></td>
                    <td><strong>{o.customer_name}</strong><small>{localPhone(o.customer_phone)}</small></td>
                    <td>{kes(o.total_kes)}</td><td>{kes(paidTowards(o))}{Number(o.refunded_kes) > 0 && <small>− {kes(o.refunded_kes)} refunded</small>}</td>
                    <td className={Number(o.event_order_balance) > 0 ? "eo-dash-due" : undefined}>{kes(o.event_order_balance)}</td>
                    <td><span className={`dash-badge eo-ps-${o.payment_status}`}>{PAYMENT_STATUS[o.payment_status].label}</span></td>
                    <td><span className={`dash-badge eo-os-${o.order_status}`}>{ORDER_STATUS[o.order_status].label}</span></td>
                    <td>{name(o.created_by)}</td><td>{when(o.created_at)}</td>
                  </tr>
                  {open === o.id && <tr className="eo-dash-detail"><td colSpan={9}><OrderAdmin order={o} name={name} onChanged={onChanged} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dash-muted">Refunds and corrections are added as new records; payment history is never edited or deleted.</p>
    </div>
  );
}

// ---------------------------------------------------------------- order detail + admin actions
function OrderAdmin({ order, name, onChanged }: { order: EventOrder; name: (id: string | null) => string; onChanged: () => void }) {
  const [acting, setActing] = useState<{ kind: "cancel" } | { kind: "refund" | "correction"; payment: OrderPayment; left: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const pays = order.event_order_payments ?? [];
  const leftOn = (p: OrderPayment) => Number(p.amount_kes) - pays.filter((x) => x.reverses_payment_id === p.id).reduce((s, x) => s + Number(x.amount_kes), 0);

  async function apply() {
    if (!acting) return;
    setMsg("");
    const supabase = createClient();
    const res = acting.kind === "cancel"
      ? await supabase.rpc("cancel_event_order", { p_order_id: order.id, p_reason: reason })
      : await supabase.rpc("reverse_event_order_payment", { p_payment_id: acting.payment.id, p_kind: acting.kind, p_amount: Number(amount), p_reason: reason });
    const d = res.data as any;
    if (res.error || d?.error) { setMsg(res.error?.code === "42501" ? "Only admins can do this." : orderError(d?.error, d)); return; }
    setActing(null); setAmount(""); setReason("");
    onChanged();
  }

  return (
    <div className="eo-dash-panel">
      <div className="eo-dash-cols">
        <div>
          <h3 className="dash-sub">Items</h3>
          {(order.event_order_items ?? []).map((i) => <div key={i.name} className="eo-dash-line"><span>{i.qty} × {i.name} @ {kes(i.unit_price_kes)}</span><strong>{kes(i.line_total_kes)}</strong></div>)}
          <div className="eo-dash-line"><span>Total</span><strong>{kes(order.total_kes)}</strong></div>
          {order.customer_email && <p className="dash-muted">Email: {order.customer_email}</p>}
          {order.note && <p className="dash-muted">Note: {order.note}</p>}
          <p className="dash-muted">
            Receipt: <a href={`/receipt/${order.receipt_token}`} target="_blank" rel="noopener noreferrer">open</a>
            {order.fulfilled_at ? ` · Handed over ${when(order.fulfilled_at)} by ${name(order.fulfilled_by)}` : ""}
            {order.cancel_reason ? ` · Cancelled: ${order.cancel_reason}` : ""}
          </p>
        </div>
        <div>
          <h3 className="dash-sub">Payments</h3>
          {pays.length === 0 && <p className="dash-muted">None yet.</p>}
          {pays.map((p) => {
            const left = p.kind === "payment" ? leftOn(p) : 0;
            return (
              <div key={p.id} className="eo-dash-line">
                <span>
                  {p.kind === "payment" ? methodLabel(p.method) : p.kind === "refund" ? "Refund" : "Correction"}
                  {p.reference ? ` · ${p.reference}` : ""} · {name(p.recorded_by)} · {when(p.recorded_at)}
                  {p.kind !== "payment" && p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="eo-dash-pay-right">
                  <strong>{p.kind === "payment" ? "" : "− "}{kes(p.amount_kes)}</strong>
                  {p.kind === "payment" && left > 0 && order.order_status !== "cancelled" && (
                    <>
                      <button type="button" className="dash-btn small" onClick={() => { setActing({ kind: "refund", payment: p, left }); setAmount(String(left)); setReason(""); setMsg(""); }}>Refund…</button>
                      <button type="button" className="dash-btn small ghost" onClick={() => { setActing({ kind: "correction", payment: p, left }); setAmount(String(left)); setReason(""); setMsg(""); }}>Correct…</button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
          {order.order_status === "open" && (
            <button type="button" className="dash-btn small danger" style={{ marginTop: 10 }} onClick={() => { setActing({ kind: "cancel" }); setReason(""); setMsg(""); }}>Cancel order…</button>
          )}
        </div>
      </div>
      {acting && (
        <div className="dash-inline-confirm eo-dash-act">
          <span>
            {acting.kind === "cancel" ? "Cancel this order" : acting.kind === "refund"
              ? `Refund money handed back (up to ${kes(acting.left)})` : `Correct a payment recorded by mistake (up to ${kes(acting.left)})`}
          </span>
          {acting.kind !== "cancel" && <input type="number" min={1} max={acting.left} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />}
          <input placeholder="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <button type="button" className="dash-btn small danger" onClick={apply} disabled={!reason.trim()}>Confirm</button>
          <button type="button" className="dash-btn small ghost" onClick={() => { setActing(null); setMsg(""); }}>Back</button>
        </div>
      )}
      {msg && <p className="dash-error">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- menu
function MenuEditor({ eventId, menu, onChanged }: { eventId: string; menu: MenuItem[]; onChanged: () => void }) {
  const [draft, setDraft] = useState({ name: "", price: "", description: "" });
  const [edit, setEdit] = useState<Record<string, { name: string; price: string; description: string }>>({});
  const [msg, setMsg] = useState("");

  async function add() {
    setMsg("");
    const price = Number(draft.price);
    if (draft.name.trim().length < 2 || !(price > 0)) { setMsg("Give the item a name and a price above zero."); return; }
    const { error } = await createClient().from("event_menu_items").insert({
      event_id: eventId, name: draft.name.trim(), price_kes: price, description: draft.description.trim() || null,
      is_active: true, position: menu.length ? Math.max(...menu.map((m) => m.position)) + 1 : 1,
    });
    if (error) { setMsg(error.message); return; }
    setDraft({ name: "", price: "", description: "" });
    onChanged();
  }
  async function save(m: MenuItem, patch: Partial<MenuItem>) {
    setMsg("");
    const { data, error } = await createClient().from("event_menu_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", m.id).select("id");
    if (error || !data?.length) { setMsg(error?.message ?? "Not saved — only admins can change the menu."); return; }
    setEdit((e) => { const n = { ...e }; delete n[m.id]; return n; });
    onChanged();
  }

  return (
    <div className="dash-card">
      <h2>On-site menu</h2>
      <p className="dash-muted">What staff can sell at this event. Changing a price never changes orders already taken (each order keeps the price it was sold at). Retire items instead of deleting them.</p>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead><tr><th>Item</th><th>Price</th><th>On sale</th><th /></tr></thead>
          <tbody>
            {menu.map((m) => {
              const e = edit[m.id];
              return (
                <tr key={m.id} className={m.is_active ? undefined : "eo-dash-retired"}>
                  <td>{e ? <><input value={e.name} onChange={(x) => setEdit({ ...edit, [m.id]: { ...e, name: x.target.value } })} aria-label="Name" />
                      <input value={e.description} placeholder="Description (optional)" onChange={(x) => setEdit({ ...edit, [m.id]: { ...e, description: x.target.value } })} aria-label="Description" /></>
                    : <><strong>{m.name}</strong>{m.description && <small>{m.description}</small>}</>}</td>
                  <td>{e ? <input type="number" min={1} value={e.price} onChange={(x) => setEdit({ ...edit, [m.id]: { ...e, price: x.target.value } })} aria-label="Price" /> : kes(m.price_kes)}</td>
                  <td>
                    <button type="button" className={`dash-btn small${m.is_active ? "" : " ghost"}`} onClick={() => save(m, { is_active: !m.is_active })}>
                      {m.is_active ? "On sale" : "Retired"}
                    </button>
                  </td>
                  <td className="dash-row-actions">
                    {e ? (
                      <>
                        <button type="button" className="dash-btn small primary" onClick={() => {
                          const price = Number(e.price);
                          if (e.name.trim().length < 2 || !(price > 0)) { setMsg("Give the item a name and a price above zero."); return; }
                          save(m, { name: e.name.trim(), price_kes: price, description: e.description.trim() || null });
                        }}>Save</button>
                        <button type="button" className="dash-btn small ghost" onClick={() => setEdit((x) => { const n = { ...x }; delete n[m.id]; return n; })}>Cancel</button>
                      </>
                    ) : <button type="button" className="dash-btn small" onClick={() => setEdit({ ...edit, [m.id]: { name: m.name, price: String(m.price_kes), description: m.description ?? "" } })}>Edit</button>}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td><input placeholder="New item, e.g. Single Plata" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="New item name" />
                <input placeholder="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="New item description" /></td>
              <td><input type="number" min={1} placeholder="KSh" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} aria-label="New item price" /></td>
              <td />
              <td className="dash-row-actions"><button type="button" className="dash-btn small primary" onClick={add}>Add item</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {msg && <p className="dash-error">{msg}</p>}
    </div>
  );
}
