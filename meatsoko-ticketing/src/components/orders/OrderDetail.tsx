"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import OrderSummary from "@/components/orders/OrderSummary";
import { kes, METHODS, orderError, receiptShareText, type EventOrder, type PayMethod } from "@/lib/event-orders";

// One order on a staff phone: the summary, Add payment (any staff member can
// collect on anyone's order — the payment is theirs), hand-over (fulfil) and
// the customer's receipt link.
export default function OrderDetail({ order, eventName, me, isAdmin, names }: {
  order: EventOrder; eventName: string; me: string; isAdmin: boolean; names: Record<string, string>;
}) {
  const router = useRouter();
  const balance = Number(order.event_order_balance);
  const open = order.order_status === "open";
  const accepted = order.assignment_status === "accepted";
  const incomingForMe = order.event_order_stage === "incoming" && order.assigned_to === me;
  const [amount, setAmount] = useState(String(balance || ""));
  const [method, setMethod] = useState<PayMethod>("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<"" | "pay" | "fulfil" | "respond">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { setAmount(String(balance || "")); }, [balance]);
  useEffect(() => {
    if (window.location.hash === "#pay") document.getElementById("pay")?.scrollIntoView({ block: "start" });
  }, []);

  async function pay() {
    setMsg(null);
    const n = Number(amount);
    if (!(n > 0)) { setMsg({ tone: "err", text: orderError("bad_amount") }); return; }
    if (method === "mpesa" && !/^[A-Za-z0-9]{8,12}$/.test(reference.trim())) { setMsg({ tone: "err", text: orderError("mpesa_code_required") }); return; }
    setBusy("pay");
    const { data, error } = await createClient().rpc("record_event_order_payment", {
      p_order_id: order.id, p_amount: n, p_method: method, p_reference: reference.trim() || null,
    });
    setBusy("");
    const r = data as any;
    if (error || r?.error) { setMsg({ tone: "err", text: error?.code === "42501" ? "Your account can't record payments." : orderError(r?.error, r) }); return; }
    setReference("");
    setMsg({ tone: "ok", text: `${kes(n)} recorded. ${Number(r.balance_kes) > 0 ? `Balance ${kes(r.balance_kes)}.` : "Fully paid."}` });
    router.refresh();
  }

  async function fulfil() {
    setMsg(null);
    setBusy("fulfil");
    const { data, error } = await createClient().rpc("fulfil_event_order", { p_order_id: order.id });
    setBusy("");
    const r = data as any;
    if (error || r?.error) { setMsg({ tone: "err", text: orderError(r?.error, r) }); return; }
    setMsg({ tone: "ok", text: "Marked as handed over." });
    router.refresh();
  }

  async function respond(accept: boolean) {
    setMsg(null);
    setBusy("respond");
    const { data, error } = await createClient().rpc("respond_event_order", { p_order_id: order.id, p_accept: accept });
    setBusy("");
    const r = data as any;
    if (error || r?.error) { setMsg({ tone: "err", text: orderError(r?.error, r) }); router.refresh(); return; }
    setMsg({ tone: "ok", text: accept ? "Accepted — it's yours. Take the payment when you serve it." : "Declined — the customer will pick someone else." });
    router.refresh();
  }

  const share = typeof window === "undefined" ? "" : receiptShareText(order, eventName, balance, window.location.origin);
  return (
    <div className="stack eo-flow">
      {msg && <p className={msg.tone === "ok" ? "eo-msg ok" : "field-error"} role={msg.tone === "err" ? "alert" : "status"}>{msg.text}</p>}
      <OrderSummary order={order} eventName={eventName} names={names} me={me} />

      {incomingForMe && (
        <div className="card eo-incoming-card">
          <strong>{order.customer_name} sent this order to you</strong>
          <span className="small">Accept it to take it on, or decline so they can pick someone else.</span>
          <div className="eo-actions">
            <button type="button" className="btn-ghost" disabled={busy !== ""} onClick={() => respond(false)}>Decline</button>
            <button type="button" className="btn-pay" disabled={busy !== ""} onClick={() => respond(true)}>{busy === "respond" ? "…" : "Accept"}</button>
          </div>
        </div>
      )}
      {open && !accepted && !incomingForMe && (
        <p className="small" style={{ margin: 0 }}>{order.event_order_stage === "incoming" ? "Waiting for the staff member it was sent to." : "Waiting for the customer to pick someone to serve them."}</p>
      )}

      {open && accepted && balance > 0 && (
        <div className="card" id="pay">
          <span className="eyebrow">Add payment</span>
          <label className="field"><span>Amount (KSh) — balance {kes(balance)}</span>
            <input type="number" inputMode="numeric" min={1} max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <div className="eo-seg four" role="radiogroup" aria-label="Payment method">
            {METHODS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={method === m.id} className={method === m.id ? "on" : undefined} onClick={() => setMethod(m.id)}>{m.label}</button>)}
          </div>
          {method !== "cash" && (
            <label className="field"><span>{method === "mpesa" ? "M-Pesa code" : "Reference (optional)"}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" maxLength={40} /></label>
          )}
          <button type="button" className="btn-pay btn-block" disabled={busy !== ""} onClick={pay}>{busy === "pay" ? "Recording…" : `Record ${kes(Number(amount) || 0)}`}</button>
        </div>
      )}

      <div className="eo-actions">
        {open && accepted && (balance === 0 || isAdmin) && (
          <button type="button" className="btn-primary" disabled={busy !== ""} onClick={fulfil}>
            {busy === "fulfil" ? "Saving…" : balance > 0 ? `Hand over with ${kes(balance)} due (admin)` : "Mark handed over"}
          </button>
        )}
        {open && accepted && balance > 0 && !isAdmin && <p className="small" style={{ margin: 0 }}>Hand-over unlocks once the order is fully paid.</p>}
        <a className="btn btn-pay" href={`https://wa.me/${order.customer_phone}?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">Share receipt</a>
        <a className="btn btn-ghost" href={`/receipt/${order.receipt_token}`} target="_blank" rel="noopener noreferrer">Open receipt</a>
      </div>
    </div>
  );
}
