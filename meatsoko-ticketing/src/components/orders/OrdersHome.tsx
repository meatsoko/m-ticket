"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { kes, localPhone, ORDER_STATUS, PAYMENT_STATUS, when, type EventOrder } from "@/lib/event-orders";
import type { OrderEvent } from "@/lib/event-orders-server";

type Filter = "all" | "mine" | "due" | "fulfil";

// Staff phone home for Event Orders: start an order in one tap, or find one by
// order number, name, phone or payment reference and follow it up.
export default function OrdersHome({ event, events, orders, me, names }: {
  event: OrderEvent; events: OrderEvent[]; orders: (EventOrder & { event_order_payments?: { reference: string | null }[] })[];
  me: string; names: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return orders.filter((o) => {
      if (filter === "mine" && o.created_by !== me) return false;
      if (filter === "due" && !(Number(o.event_order_balance) > 0)) return false;
      if (filter === "fulfil" && !(o.order_status === "open" && Number(o.event_order_balance) === 0)) return false;
      if (!term) return true;
      return o.order_number.toLowerCase().includes(term) || o.customer_name.toLowerCase().includes(term)
        || (digits.length >= 3 && (o.customer_phone.includes(digits) || localPhone(o.customer_phone).includes(digits)))
        || (o.event_order_payments ?? []).some((p) => (p.reference ?? "").toLowerCase().includes(term));
    });
  }, [orders, q, filter, me]);

  const mine = orders.filter((o) => o.created_by === me);
  const due = orders.filter((o) => Number(o.event_order_balance) > 0);
  const toFulfil = orders.filter((o) => o.order_status === "open" && Number(o.event_order_balance) === 0);

  return (
    <div className="stack eo-home">
      <div className="card eo-event-card">
        <span className="eyebrow">Taking orders for</span>
        {events.length > 1 ? (
          <select aria-label="Event" value={event.id} onChange={(e) => { window.location.href = `/orders?event=${e.target.value}`; }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        ) : <strong>{event.name}</strong>}
        <Link href={`/orders/new?event=${event.id}`} className="btn btn-primary btn-block eo-new">+ New order</Link>
      </div>

      <input type="search" inputMode="search" placeholder="Order no., name, phone or M-Pesa code" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
      <div className="eo-chips" role="group" aria-label="Filter orders">
        {([["all", `All ${orders.length}`], ["mine", `Mine ${mine.length}`], ["due", `Balance due ${due.length}`], ["fulfil", `To hand over ${toFulfil.length}`]] as [Filter, string][]).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? "on" : undefined} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty"><strong>{orders.length ? "No orders match" : "No orders yet"}</strong>
          <span className="small">{orders.length ? "Try the order number or the last digits of the phone." : "Tap New order to take the first one."}</span></div>
      ) : (
        <ul className="eo-list">
          {shown.slice(0, 200).map((o) => {
            const bal = Number(o.event_order_balance);
            const ps = PAYMENT_STATUS[o.payment_status];
            return (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="eo-row">
                  <span className="eo-row-top">
                    <strong className="num">{o.order_number}</strong>
                    <span className="num">{kes(o.total_kes)}</span>
                  </span>
                  <span className="eo-row-mid">
                    <span className="eo-ellipsis">{o.customer_name}</span>
                    {bal > 0 ? <span className="eo-due num">Due {kes(bal)}</span> : <span className={`pill ${ps.tone}`}>{ps.label}</span>}
                  </span>
                  <span className="small">
                    {ORDER_STATUS[o.order_status].label} · {o.created_by === me ? "You" : names[o.created_by] ?? "Staff"} · {when(o.created_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
