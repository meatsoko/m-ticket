"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { kes, methodLabel, orderError, ORDER_STATUS, PAYMENT_STATUS, STAGE, when, type OrderStatus, type PaymentStatus, type Stage } from "@/lib/event-orders";

type Receipt = {
  event: { name: string; venue: string | null; starts_at: string };
  order_number: string; customer_name: string; customer_phone: string;
  total_kes: number; paid_kes: number; refunded_kes: number; balance_kes: number;
  payment_status: PaymentStatus; order_status: OrderStatus; created_at: string; fulfilled_at: string | null;
  source: "staff" | "customer"; stage: Stage; staff_name: string | null; can_cancel: boolean;
  available_staff: { id: string; name: string }[] | null; requested_at: string | null; accepted_at: string | null;
  items: { name: string; qty: number; unit_price_kes: number; line_total_kes: number }[];
  payments: { kind: "payment" | "refund" | "correction"; amount_kes: number; method: string; reference: string | null; at: string }[];
};

const LIVE: Stage[] = ["incoming", "needs_staff", "pending", "paid"];
const STEPS: { stage: Stage[]; label: string }[] = [
  { stage: ["incoming", "needs_staff"], label: "Sent" },
  { stage: ["pending"], label: "Accepted" },
  { stage: ["paid"], label: "Paid" },
  { stage: ["closed"], label: "Handed over" },
];

// The customer's order page: live status (who is serving them, where the order
// is), then the receipt. Public by the receipt token only (event-order-receipt).
export default function ReceiptView({ token }: { token: string }) {
  const [r, setR] = useState<Receipt | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!/^[a-f0-9]{32}$/.test(token)) { setState("missing"); return; }
    const res = await invokeFn(createClient(), "event-order-receipt", { token });
    if (res.data?.order_number) { setR(res.data as Receipt); setState("ok"); }
    else setState((s) => (s === "ok" ? s : res.errorCode === "not_found" ? "missing" : "error"));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // While the order is in progress, keep the status fresh.
  useEffect(() => {
    if (!r || !LIVE.includes(r.stage)) return;
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [r, load]);

  async function act(body: Record<string, unknown>) {
    setMsg(""); setBusy(true);
    const res = await invokeFn(createClient(), "customer-order", { receipt_token: token, ...body });
    setBusy(false);
    if (res.errorCode) setMsg(orderError(res.errorCode, res.data as any));
    load();
  }

  if (state === "loading") return <p className="small">Loading your order…</p>;
  if (state !== "ok" || !r) return (
    <div className="empty"><strong>{state === "missing" ? "Order not found" : "Couldn't load the order"}</strong>
      <span className="small">{state === "missing" ? "Check the link you were sent." : "Check your connection and try again."}</span></div>
  );
  const ps = PAYMENT_STATUS[r.payment_status];
  const stepIdx = STEPS.findIndex((s) => s.stage.includes(r.stage));
  const live = LIVE.includes(r.stage);
  return (
    <article className="stack eo-receipt">
      <header className="card eo-receipt-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} className="eo-receipt-logo" />
        <span className="eyebrow">{r.event.name}{r.event.venue ? ` · ${r.event.venue}` : ""}</span>
        <span className="small">Order</span>
        <strong className="num eo-receipt-no">{r.order_number}</strong>
        <div className="row" style={{ justifyContent: "center", gap: 8 }}>
          <span className={`pill ${STAGE[r.stage].tone}`}>{STAGE[r.stage].label}</span>
          <span className={`pill ${ps.tone}`}>{ps.label}</span>
        </div>
      </header>

      {r.source === "customer" && r.stage !== "cancelled" && r.stage !== "refunded" && (
        <section className="card">
          <ol className="eo-track" aria-label="Order progress">
            {STEPS.map((s, i) => <li key={s.label} className={i < stepIdx ? "done" : i === stepIdx ? "on" : undefined}>{s.label}</li>)}
          </ol>
          <p className="eo-track-msg">
            {r.stage === "incoming" && <>Sent to <strong>{r.staff_name ?? "a staff member"}</strong> — waiting for them to accept.</>}
            {r.stage === "needs_staff" && <>Your order wasn&apos;t accepted in time. Choose someone else to serve you.</>}
            {r.stage === "pending" && <><strong>{r.staff_name ?? "Your server"}</strong> accepted your order. Pay {r.staff_name ?? "them"} {kes(r.balance_kes)} when they come.</>}
            {r.stage === "paid" && <>Paid — <strong>{r.staff_name ?? "your server"}</strong> will hand it over.</>}
            {r.stage === "closed" && <>Handed over{r.fulfilled_at ? ` ${when(r.fulfilled_at)}` : ""}. Enjoy!</>}
          </p>
          {r.stage === "needs_staff" && (
            (r.available_staff ?? []).length ? (
              <div className="eo-staff-pick" role="group" aria-label="Choose someone else">
                {(r.available_staff ?? []).map((s) => (
                  <button key={s.id} type="button" disabled={busy} onClick={() => act({ action: "reassign", staff_id: s.id })}>
                    <span className="eo-avatar" aria-hidden="true">{s.name.charAt(0).toUpperCase()}</span><strong>{s.name}</strong><span className="small">Send to {s.name}</span>
                  </button>
                ))}
              </div>
            ) : <p className="small" style={{ margin: 0 }}>No one is free right now — this page refreshes by itself.</p>
          )}
          {r.can_cancel && <button type="button" className="btn-ghost" disabled={busy} onClick={() => act({ action: "cancel" })}>Cancel order</button>}
          {msg && <p className="field-error" role="alert" style={{ margin: 0 }}>{msg}</p>}
          {live && <span className="small">This page updates by itself.</span>}
        </section>
      )}

      <section className="card">
        <div className="row"><span className="small">Customer</span><strong>{r.customer_name}</strong></div>
        <div className="row"><span className="small">Phone</span><span className="num">{r.customer_phone}</span></div>
        {r.staff_name && <div className="row"><span className="small">Served by</span><strong>{r.staff_name}</strong></div>}
        <div className="row"><span className="small">Date</span><span>{when(r.created_at)}</span></div>
      </section>
      <section className="card">
        {r.items.map((i) => (
          <div key={i.name} className="row eo-line"><span><b className="num">{i.qty}×</b> {i.name} <span className="small">@ {kes(i.unit_price_kes)}</span></span><span className="num">{kes(i.line_total_kes)}</span></div>
        ))}
        <div className="eo-totals">
          <div className="row"><span>Total</span><strong className="num">{kes(r.total_kes)}</strong></div>
          <div className="row"><span>Paid</span><span className="num">{kes(r.paid_kes)}</span></div>
          {Number(r.refunded_kes) > 0 && <div className="row"><span>Refunded</span><span className="num">− {kes(r.refunded_kes)}</span></div>}
          <div className={`row eo-balance${Number(r.balance_kes) > 0 ? " due" : ""}`}><span>Balance</span><strong className="num">{kes(r.balance_kes)}</strong></div>
        </div>
      </section>
      {r.payments.length > 0 && (
        <section className="card">
          <span className="eyebrow">Payments</span>
          {r.payments.map((p, i) => (
            <div key={i} className="row eo-pay">
              <span>{p.kind === "payment" ? methodLabel(p.method) : p.kind === "refund" ? "Refund" : "Correction"}{p.reference ? <span className="small"> {p.reference}</span> : null}
                <span className="small" style={{ display: "block" }}>{when(p.at)}</span></span>
              <strong className="num">{p.kind === "payment" ? "" : "− "}{kes(p.amount_kes)}</strong>
            </div>
          ))}
        </section>
      )}
      <p className="small" style={{ textAlign: "center", margin: 0 }}>
        {ORDER_STATUS[r.order_status].label} · Nothing is charged online — pay the staff member. Thank you for eating with MeatSoko.
      </p>
    </article>
  );
}
