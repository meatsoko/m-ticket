"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  kes, localPhone, orderError, REQUEST_MINUTES, STAFF_STATUS, STAGE, when,
  type EventOrder, type Stage, type StaffStatus,
} from "@/lib/event-orders";
import type { OrderEvent } from "@/lib/event-orders-server";

type Tab = "incoming" | "pending" | "paid" | "closed" | "all";
type Row = EventOrder & { event_order_items?: { name: string; qty: number }[]; event_order_payments?: { reference: string | null }[] };

// Staff phone home for Event Orders: your availability (what customers see),
// your orders tracked by stage — incoming (accept / decline), pending (payment
// due), paid (hand over), closed — a New order button, and search across the
// whole event. Refreshes itself so new customer orders appear.
export default function OrdersHome({ event, events, orders, me, names, myStatus, suggestedName }: {
  event: OrderEvent; events: OrderEvent[]; orders: Row[]; me: string; names: Record<string, string>;
  myStatus: { display_name: string; status: StaffStatus } | null; suggestedName: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"mine" | "everyone">("mine");
  const [q, setQ] = useState("");
  const mineIncoming = orders.filter((o) => o.assigned_to === me && o.event_order_stage === "incoming").length;
  const [tab, setTab] = useState<Tab>(mineIncoming ? "incoming" : "pending");
  // The countdown is browser-only (0 on the server) so server and browser render the same.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => router.refresh(), 15000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [router]);

  const scoped = scope === "mine" ? orders.filter((o) => o.assigned_to === me || (o.assigned_to === null && o.created_by === me)) : orders;
  const inTab = (o: Row, t: Tab) => {
    const s = o.event_order_stage;
    if (t === "all") return true;
    if (t === "incoming") return s === "incoming" || s === "needs_staff";
    if (t === "closed") return s === "closed" || s === "cancelled" || s === "refunded";
    return s === t;
  };
  const count = (t: Tab) => scoped.filter((o) => inTab(o, t)).length;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    // Search covers the whole event, whatever the tab.
    const base = term ? orders : scoped.filter((o) => inTab(o, tab));
    return base.filter((o) => !term
      || o.order_number.toLowerCase().includes(term) || o.customer_name.toLowerCase().includes(term)
      || (digits.length >= 3 && (o.customer_phone.includes(digits) || localPhone(o.customer_phone).includes(digits)))
      || (o.event_order_payments ?? []).some((p) => (p.reference ?? "").toLowerCase().includes(term)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, scoped, tab, q]);

  return (
    <div className="stack eo-home">
      <Availability eventId={event.id} current={myStatus} suggestedName={suggestedName} />

      <div className="card eo-event-card">
        <span className="eyebrow">Taking orders for</span>
        {events.length > 1 ? (
          <select aria-label="Event" value={event.id} onChange={(e) => { window.location.href = `/orders?event=${e.target.value}`; }}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        ) : <strong>{event.name}</strong>}
        <Link href={`/orders/new?event=${event.id}`} className="btn btn-primary btn-block eo-new">+ New order</Link>
      </div>

      <input type="search" inputMode="search" placeholder="Search all orders: no., name, phone, M-Pesa code" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />

      {!q && (
        <>
          <div className="eo-scope" role="group" aria-label="Whose orders">
            <button type="button" className={scope === "mine" ? "on" : undefined} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>My orders</button>
            <button type="button" className={scope === "everyone" ? "on" : undefined} aria-pressed={scope === "everyone"} onClick={() => setScope("everyone")}>Everyone</button>
          </div>
          <div className="eo-chips" role="tablist" aria-label="Order stage">
            {([["incoming", "Incoming"], ["pending", "Pending"], ["paid", "Paid"], ["closed", "Closed"], ["all", "All"]] as [Tab, string][]).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${tab === id ? "on" : ""}${id === "incoming" && count("incoming") ? " alert" : ""}`} onClick={() => setTab(id)}>
                {label} {count(id)}
              </button>
            ))}
          </div>
        </>
      )}

      {shown.length === 0 ? (
        <div className="empty"><strong>{q ? "No orders match" : tab === "incoming" ? "No incoming orders" : "Nothing here"}</strong>
          <span className="small">{q ? "Try the order number or the last digits of the phone." : tab === "incoming" ? (myStatus?.status === "available" ? "Customers who pick you will appear here." : "Set yourself Available so customers can pick you.") : "Orders move here as they progress."}</span></div>
      ) : (
        <ul className="eo-list">
          {shown.slice(0, 200).map((o) => <OrderRow key={o.id} o={o} me={me} names={names} now={now} onDone={() => router.refresh()} />)}
        </ul>
      )}
    </div>
  );
}

function OrderRow({ o, me, names, now, onDone }: { o: Row; me: string; names: Record<string, string>; now: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const stage = STAGE[o.event_order_stage as Stage];
  const bal = Number(o.event_order_balance);
  const incomingForMe = o.event_order_stage === "incoming" && o.assigned_to === me;
  const left = o.requested_at ? Math.max(0, REQUEST_MINUTES * 60 - Math.floor((now - new Date(o.requested_at).getTime()) / 1000)) : 0;
  const who = (id: string | null) => (!id ? "—" : id === me ? "You" : names[id] ?? "Staff");

  async function respond(accept: boolean) {
    setErr(""); setBusy(true);
    const { data, error } = await createClient().rpc("respond_event_order", { p_order_id: o.id, p_accept: accept });
    setBusy(false);
    const d = data as any;
    if (error || d?.error) { setErr(orderError(d?.error)); onDone(); return; }
    onDone();
  }

  return (
    <li className={incomingForMe ? "eo-incoming" : undefined}>
      <Link href={`/orders/${o.id}`} className="eo-row">
        <span className="eo-row-top">
          <strong className="num">{o.order_number}</strong>
          <span className="num">{kes(o.total_kes)}</span>
        </span>
        <span className="eo-row-mid">
          <span className="eo-ellipsis">{o.customer_name}{o.source === "customer" ? " · from pass" : ""}</span>
          {o.event_order_stage === "pending" && bal > 0 ? <span className="eo-due num">Due {kes(bal)}</span> : <span className={`pill ${stage.tone}`}>{stage.label}</span>}
        </span>
        {(o.event_order_items ?? []).length > 0 && (
          <span className="small eo-ellipsis">{(o.event_order_items ?? []).map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
        )}
        <span className="small">
          {o.source === "customer" ? `Sent to ${who(o.assigned_to)}` : `Taken by ${who(o.created_by)}`} · {when(o.created_at)}
          {o.note ? ` · “${o.note}”` : ""}
        </span>
      </Link>
      {incomingForMe && (
        <div className="eo-respond">
          <span className="small">{!now ? "Accept soon" : left > 0 ? `Accept within ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Expiring…"}</span>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => respond(false)}>Decline</button>
          <button type="button" className="btn-pay" disabled={busy} onClick={() => respond(true)}>{busy ? "…" : "Accept"}</button>
          {err && <span className="field-error" role="alert">{err}</span>}
        </div>
      )}
    </li>
  );
}

// Available / Busy / Offline, and the first name customers see.
function Availability({ eventId, current, suggestedName }: { eventId: string; current: { display_name: string; status: StaffStatus } | null; suggestedName: string }) {
  const router = useRouter();
  const [name, setName] = useState(current?.display_name ?? suggestedName);
  const [status, setStatus] = useState<StaffStatus>(current?.status ?? "offline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(!current);

  async function save(next: StaffStatus) {
    setErr("");
    if (!name.trim()) { setErr(orderError("name_required")); setEditing(true); return; }
    setBusy(true);
    const { data, error } = await createClient().rpc("set_event_staff_status", { p_event_id: eventId, p_display_name: name.trim(), p_status: next });
    setBusy(false);
    const d = data as any;
    if (error || d?.error) { setErr(orderError(d?.error)); return; }
    setStatus(next); setEditing(false);
    router.refresh();
  }

  return (
    <div className={`card eo-avail is-${status}`}>
      <div className="row">
        <span className="eyebrow">Your status</span>
        {!editing && <button type="button" className="eo-link" onClick={() => setEditing(true)}>Customers see “{name}” · change</button>}
      </div>
      {editing && (
        <label className="field"><span>Your first name (customers see this)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="given-name" /></label>
      )}
      <div className="eo-seg" role="radiogroup" aria-label="Availability">
        {STAFF_STATUS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={status === s.id} className={status === s.id ? `on ${s.id}` : undefined} disabled={busy} onClick={() => save(s.id)}>{s.label}</button>
        ))}
      </div>
      <span className="small">{status === "available" ? "Customers can send you orders." : status === "busy" ? "Customers can't pick you right now; your orders stay with you." : "You're not taking customer orders."}</span>
      {err && <span className="field-error" role="alert">{err}</span>}
    </div>
  );
}
