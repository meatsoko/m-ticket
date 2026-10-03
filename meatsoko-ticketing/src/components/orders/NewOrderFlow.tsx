"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import OrderSummary from "@/components/orders/OrderSummary";
import {
  kes, METHODS, ORDER_COLUMNS, PAYMENT_COLUMNS, orderError, orderPhone, receiptShareText,
  type EventOrder, type MenuItem, type PayMethod,
} from "@/lib/event-orders";
import { looksLikeEmail } from "@/lib/phone";

// New order on a staff phone: Customer → Items → Review → Payment → Create →
// Receipt. Prices come from the menu on the server (create_event_order); the
// phone only sends menu item ids and quantities.

type Step = "customer" | "items" | "review" | "payment" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "customer", label: "Customer" }, { id: "items", label: "Items" }, { id: "review", label: "Review" }, { id: "payment", label: "Payment" },
];

export default function NewOrderFlow({ event, menu, me, names }: {
  event: { id: string; name: string }; menu: MenuItem[]; me: string; names: Record<string, string>;
}) {
  const [step, setStep] = useState<Step>("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [payMode, setPayMode] = useState<"none" | "full" | "part">("full");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<EventOrder | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => { top.current?.scrollIntoView({ block: "start" }); }, [step]);

  const lines = menu.filter((m) => (qty[m.id] ?? 0) > 0);
  const total = lines.reduce((s, m) => s + Number(m.price_kes) * (qty[m.id] ?? 0), 0);
  const count = lines.reduce((s, m) => s + (qty[m.id] ?? 0), 0);
  const payAmount = payMode === "full" ? total : payMode === "part" ? Number(amount) || 0 : 0;
  const bump = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] ?? 0) + d)) }));

  const customerOk = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Enter the customer's name.";
    if (!orderPhone(phone)) e.phone = "Use 07XX XXX XXX.";
    if (email.trim() && !looksLikeEmail(email)) e.email = "That email doesn't look right.";
    setFieldErr(e);
    return !Object.keys(e).length;
  };
  const paymentOk = () => {
    const e: Record<string, string> = {};
    if (payMode === "part" && !(payAmount > 0 && payAmount < total)) e.amount = `Enter an amount between 1 and ${kes(total - 1)}.`;
    if (payMode !== "none" && method === "mpesa" && !/^[A-Za-z0-9]{8,12}$/.test(reference.trim())) e.reference = "Enter the M-Pesa code (e.g. QWE12RTY34).";
    setFieldErr(e);
    return !Object.keys(e).length;
  };

  async function create() {
    setErr("");
    if (!paymentOk()) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_event_order", {
      p_event_id: event.id, p_customer_name: name.trim(), p_customer_phone: phone, p_customer_email: email.trim() || null,
      p_items: lines.map((m) => ({ menu_item_id: m.id, qty: qty[m.id] })),
      p_payment: payMode === "none" ? null : { amount: payAmount, method, reference: reference.trim() || null },
      p_note: note.trim() || null,
    });
    const res = data as any;
    if (error || res?.error) {
      setBusy(false);
      const code = res?.error ?? (error?.message?.match(/payment_rejected:(\w+)/)?.[1]) ?? (error?.code === "42501" ? "forbidden" : undefined);
      setErr(code === "forbidden" ? "Your account can't take orders. Sign in again." : orderError(code, res));
      return;
    }
    const { data: full } = await supabase.from("event_orders")
      .select(`${ORDER_COLUMNS},event_order_items(name,qty,unit_price_kes,line_total_kes),event_order_payments(${PAYMENT_COLUMNS})`)
      .eq("id", res.id).single();
    setBusy(false);
    setOrder(full as unknown as EventOrder);
    setStep("done");
  }

  function reset() {
    setName(""); setPhone(""); setEmail(""); setNote(""); setQty({}); setPayMode("full"); setMethod("cash");
    setAmount(""); setReference(""); setErr(""); setFieldErr({}); setOrder(null); setStep("customer");
  }

  // ---------- Done: the receipt screen ----------
  if (step === "done" && order) {
    const balance = Number(order.event_order_balance);
    const text = receiptShareText(order, event.name, balance, window.location.origin);
    return (
      <div className="stack eo-flow" ref={top}>
        <div className="eo-done-head"><span aria-hidden="true">✓</span> Order created</div>
        <OrderSummary order={order} eventName={event.name} names={names} me={me} />
        <div className="eo-actions">
          <a className="btn btn-pay" href={`https://wa.me/${order.customer_phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Share receipt</a>
          {balance > 0 && <Link className="btn btn-primary" href={`/orders/${order.id}#pay`}>Add payment</Link>}
          <Link className="btn btn-ghost" href={`/orders/${order.id}`}>View order</Link>
          <button type="button" className="btn-ghost" onClick={reset}>New order</button>
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="stack eo-flow" ref={top}>
      <ol className="eo-steps" aria-label="Order steps">
        {STEPS.map((s, i) => <li key={s.id} className={i < stepIndex ? "done" : i === stepIndex ? "on" : undefined} aria-current={i === stepIndex ? "step" : undefined}>{s.label}</li>)}
      </ol>

      {step === "customer" && (
        <div className="stack">
          <label className="field"><span>Customer name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" maxLength={120} aria-invalid={!!fieldErr.name} />
            {fieldErr.name && <span className="field-error">{fieldErr.name}</span>}</label>
          <label className="field"><span>Phone</span>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" autoComplete="off" aria-invalid={!!fieldErr.phone} />
            {fieldErr.phone && <span className="field-error">{fieldErr.phone}</span>}</label>
          <label className="field"><span>Email <em className="small">(optional)</em></span>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={!!fieldErr.email} />
            {fieldErr.email && <span className="field-error">{fieldErr.email}</span>}</label>
          <label className="field"><span>Note <em className="small">(optional)</em></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Table 4, no chilli" /></label>
        </div>
      )}

      {step === "items" && (
        <div className="eo-menu">
          {menu.map((m) => {
            const n = qty[m.id] ?? 0;
            return (
              <div key={m.id} className={`eo-item${n ? " on" : ""}`}>
                <button type="button" className="eo-item-main" onClick={() => bump(m.id, 1)} aria-label={`Add one ${m.name}`}>
                  <strong>{m.name}</strong>
                  <span className="num">{kes(m.price_kes)}</span>
                  {m.description && <span className="small">{m.description}</span>}
                </button>
                <div className="eo-item-qty">
                  <button type="button" onClick={() => bump(m.id, -1)} disabled={!n} aria-label={`One fewer ${m.name}`}>−</button>
                  <span className="num" aria-live="polite">{n}</span>
                  <button type="button" onClick={() => bump(m.id, 1)} disabled={n >= 99} aria-label={`One more ${m.name}`}>+</button>
                </div>
              </div>
            );
          })}
          {menu.length === 0 && <div className="empty"><strong>The menu is empty</strong><span className="small">An admin adds items in the dashboard.</span></div>}
        </div>
      )}

      {step === "review" && (
        <div className="card">
          <div className="row"><strong>{name.trim()}</strong><span className="small">{phone}</span></div>
          {lines.map((m) => (
            <div key={m.id} className="row eo-line"><span><b className="num">{qty[m.id]}×</b> {m.name}</span><span className="num">{kes(Number(m.price_kes) * (qty[m.id] ?? 0))}</span></div>
          ))}
          <div className="row eo-totals-row"><span>Total</span><strong className="num">{kes(total)}</strong></div>
          <div className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
            <button type="button" className="btn-ghost eo-mini" onClick={() => setStep("items")}>Edit items</button>
            <button type="button" className="btn-ghost eo-mini" onClick={() => setStep("customer")}>Edit customer</button>
          </div>
        </div>
      )}

      {step === "payment" && (
        <div className="stack">
          <div className="card quiet"><div className="row"><span>Total</span><strong className="num eo-big">{kes(total)}</strong></div></div>
          <div className="eo-seg" role="radiogroup" aria-label="Payment now">
            {([["full", "Paid in full"], ["part", "Part payment"], ["none", "Not yet"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={payMode === id} className={payMode === id ? "on" : undefined} onClick={() => setPayMode(id)}>{label}</button>
            ))}
          </div>
          {payMode !== "none" && (
            <>
              {payMode === "part" && (
                <label className="field"><span>Amount received (KSh)</span>
                  <input type="number" inputMode="numeric" min={1} max={total - 1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!fieldErr.amount} />
                  {fieldErr.amount ? <span className="field-error">{fieldErr.amount}</span> : <span className="small">Balance after: {kes(Math.max(total - payAmount, 0))}</span>}</label>
              )}
              <div className="field"><span className="eo-label">Method</span>
                <div className="eo-seg four" role="radiogroup" aria-label="Payment method">
                  {METHODS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={method === m.id} className={method === m.id ? "on" : undefined} onClick={() => setMethod(m.id)}>{m.label}</button>)}
                </div></div>
              {method !== "cash" && (
                <label className="field"><span>{method === "mpesa" ? "M-Pesa code" : "Reference (optional)"}</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" maxLength={40}
                    placeholder={method === "mpesa" ? "QWE12RTY34" : method === "card" ? "Card machine slip no." : ""} aria-invalid={!!fieldErr.reference} />
                  {fieldErr.reference && <span className="field-error">{fieldErr.reference}</span>}</label>
              )}
            </>
          )}
          {payMode === "none" && <p className="small">The order is saved as unpaid. Record the payment from the order when it comes in.</p>}
        </div>
      )}

      {err && <p className="field-error" role="alert">{err}</p>}

      <div className="eo-bar">
        {step !== "customer" && (
          <button type="button" className="btn-ghost" onClick={() => { setErr(""); setStep(STEPS[stepIndex - 1].id); }} disabled={busy}>Back</button>
        )}
        {step === "customer" && <button type="button" className="btn-primary eo-bar-main" onClick={() => customerOk() && setStep("items")}>Next: items</button>}
        {step === "items" && <button type="button" className="btn-primary eo-bar-main" disabled={!count} onClick={() => setStep("review")}>{count ? `Review · ${count} item${count > 1 ? "s" : ""} · ${kes(total)}` : "Add items"}</button>}
        {step === "review" && <button type="button" className="btn-primary eo-bar-main" onClick={() => setStep("payment")}>Next: payment</button>}
        {step === "payment" && <button type="button" className="btn-pay eo-bar-main" disabled={busy} onClick={create}>{busy ? "Creating…" : `Create order${payAmount ? ` · ${kes(payAmount)} paid` : ""}`}</button>}
      </div>
    </div>
  );
}
