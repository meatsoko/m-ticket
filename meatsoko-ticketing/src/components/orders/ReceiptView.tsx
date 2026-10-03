"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { kes, methodLabel, ORDER_STATUS, PAYMENT_STATUS, when, type OrderStatus, type PaymentStatus } from "@/lib/event-orders";

type Receipt = {
  event: { name: string; venue: string | null; starts_at: string };
  order_number: string; customer_name: string; customer_phone: string;
  total_kes: number; paid_kes: number; refunded_kes: number; balance_kes: number;
  payment_status: PaymentStatus; order_status: OrderStatus; created_at: string; fulfilled_at: string | null;
  items: { name: string; qty: number; unit_price_kes: number; line_total_kes: number }[];
  payments: { kind: "payment" | "refund" | "correction"; amount_kes: number; method: string; reference: string | null; at: string }[];
};

// Customer receipt (public, by the receipt token only; event-order-receipt).
export default function ReceiptView({ token }: { token: string }) {
  const [r, setR] = useState<Receipt | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(token)) { setState("missing"); return; }
    invokeFn(createClient(), "event-order-receipt", { token }).then((res) => {
      if (res.data?.order_number) { setR(res.data as Receipt); setState("ok"); }
      else setState(res.errorCode === "not_found" ? "missing" : "error");
    });
  }, [token]);

  if (state === "loading") return <p className="small">Loading your receipt…</p>;
  if (state !== "ok" || !r) return (
    <div className="empty"><strong>{state === "missing" ? "Receipt not found" : "Couldn't load the receipt"}</strong>
      <span className="small">{state === "missing" ? "Check the link you were sent." : "Check your connection and try again."}</span></div>
  );
  const ps = PAYMENT_STATUS[r.payment_status];
  return (
    <article className="stack eo-receipt">
      <header className="card eo-receipt-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} className="eo-receipt-logo" />
        <span className="eyebrow">{r.event.name}{r.event.venue ? ` · ${r.event.venue}` : ""}</span>
        <span className="small">Order</span>
        <strong className="num eo-receipt-no">{r.order_number}</strong>
        <div className="row" style={{ justifyContent: "center", gap: 8 }}>
          <span className={`pill ${ps.tone}`}>{ps.label}</span>
          <span className={`pill ${ORDER_STATUS[r.order_status].tone}`}>{ORDER_STATUS[r.order_status].label}</span>
        </div>
      </header>
      <section className="card">
        <div className="row"><span className="small">Customer</span><strong>{r.customer_name}</strong></div>
        <div className="row"><span className="small">Phone</span><span className="num">{r.customer_phone}</span></div>
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
      <p className="small" style={{ textAlign: "center", margin: 0 }}>Show this receipt at the counter. Thank you for eating with MeatSoko.</p>
    </article>
  );
}
