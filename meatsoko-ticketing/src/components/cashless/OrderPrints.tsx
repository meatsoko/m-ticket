"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import ReceiptPrint from "@/components/cashless/ReceiptPrint";
import { formatPrice } from "@/lib/merchandise";

// Printable thermal receipts (58 or 80 mm) for event orders and merchandise orders,
// built from the same data their pages already show (2026-10-16). Each is reached
// only by its private token, like the order page itself.

const kes = (n: number) => `KSh ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
const maskPhone = (p: string | null | undefined) => (p && p.length >= 6 ? `0${p.slice(3, 6)}***${p.slice(-3)}` : "");

function Shell({ children, error, loading }: { children?: React.ReactNode; error?: string; loading?: boolean }) {
  return <div className="receipt-page">{error ? <p>{error}</p> : loading ? <p>Loading…</p> : children}</div>;
}

type EventOrder = {
  event: { name: string; venue: string | null }; order_number: string; customer_name: string; customer_phone: string;
  total_kes: number; paid_kes: number; refunded_kes: number; balance_kes: number; payment_status: string; created_at: string; staff_name: string | null;
  items: { name: string; qty: number; unit_price_kes: number; line_total_kes: number }[];
  payments: { kind: "payment" | "refund" | "correction"; amount_kes: number; method: string; reference: string | null; at: string }[];
};
const METHOD: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", other: "Other" };

export function EventOrderPrint({ token }: { token: string }) {
  const [r, setR] = useState<EventOrder | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    invokeFn<EventOrder>(createClient(), "event-order-receipt", { token }).then((res) => {
      if (res.data?.order_number) setR(res.data); else setErr(res.transportError ? "No connection. Reload to try again." : "This receipt link isn't valid.");
    });
  }, [token]);
  if (err || !r) return <Shell error={err} loading={!err} />;
  return (
    <Shell>
      <section className="sale-receipt" aria-label="Order receipt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sale-receipt-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
        <p className="sale-receipt-event">{r.event.name}{r.event.venue ? ` · ${r.event.venue}` : ""}</p>
        <h1 className="sale-receipt-vendor">Order {r.order_number}</h1>
        <p className="sale-receipt-small">{r.customer_name}{r.customer_phone ? ` · ${maskPhone(r.customer_phone)}` : ""}</p>
        <div className="sale-receipt-lines">
          {r.items.map((i) => <div key={i.name}><span>{i.qty}× {i.name}</span><span>{kes(i.line_total_kes)}</span></div>)}
          <div className="total"><span>Total</span><span>{kes(r.total_kes)}</span></div>
        </div>
        <div className="sale-receipt-lines">
          {r.payments.map((p, i) => (
            <div key={i}><span>{p.kind === "payment" ? METHOD[p.method] ?? p.method : p.kind === "refund" ? "Refund" : "Correction"}{p.reference ? ` ${p.reference}` : ""}</span>
              <span>{p.kind === "payment" ? "" : "− "}{kes(p.amount_kes)}</span></div>
          ))}
          <div><span>Paid</span><span>{kes(r.paid_kes)}</span></div>
          {Number(r.balance_kes) > 0 && <div className="total"><span>Balance due</span><span>{kes(r.balance_kes)}</span></div>}
        </div>
        <dl className="sale-receipt-facts">
          <div><dt>Date</dt><dd>{when(r.created_at)}</dd></div>
          {r.staff_name && <div><dt>Served by</dt><dd>{r.staff_name}</dd></div>}
        </dl>
        <p className="sale-receipt-thanks">Thank you</p>
      </section>
      <ReceiptPrint />
    </Shell>
  );
}

type Merch = {
  order_number: string; first_name: string; payment_status: string; created_at: string; paid_at: string | null;
  delivery: { label: string; town: string | null };
  items: { product_name: string; color: string; size: string; qty: number; unit_price_kes: number }[];
  subtotal_kes: number; delivery_fee_kes: number; total_kes: number;
};

export function MerchOrderPrint({ token }: { token: string }) {
  const [o, setO] = useState<Merch | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    invokeFn<Merch>(createClient(), "merch-order", { access_token: token }).then((res) => {
      if (res.data?.order_number) setO(res.data); else setErr(res.transportError ? "No connection. Reload to try again." : "This order link isn't valid.");
    });
  }, [token]);
  if (err || !o) return <Shell error={err} loading={!err} />;
  if (o.payment_status !== "paid") return <Shell error="This order isn't paid, so there's no receipt to print yet." />;
  return (
    <Shell>
      <section className="sale-receipt" aria-label="Order receipt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sale-receipt-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
        <p className="sale-receipt-event">MeatSoko merchandise</p>
        <h1 className="sale-receipt-vendor">Order {o.order_number}</h1>
        <p className="sale-receipt-small">{o.first_name} · {o.delivery.label}{o.delivery.town ? `, ${o.delivery.town}` : ""}</p>
        <div className="sale-receipt-lines">
          {o.items.map((i, n) => <div key={n}><span>{i.qty}× {i.product_name} ({i.color}, {i.size})</span><span>{formatPrice(Number(i.unit_price_kes) * i.qty)}</span></div>)}
          {Number(o.delivery_fee_kes) > 0 && <div><span>Delivery</span><span>{formatPrice(Number(o.delivery_fee_kes))}</span></div>}
          <div className="total"><span>Total</span><span>{formatPrice(Number(o.total_kes))}</span></div>
        </div>
        <p className="sale-receipt-amount">{kes(o.total_kes)}</p>
        <p className="sale-receipt-paid">PAID</p>
        <dl className="sale-receipt-facts">
          <div><dt>Date</dt><dd>{when(o.paid_at ?? o.created_at)}</dd></div>
        </dl>
        <p className="sale-receipt-small">Keep this receipt and your order number for pickup or delivery.</p>
        <p className="sale-receipt-thanks">Thank you</p>
      </section>
      <ReceiptPrint />
    </Shell>
  );
}
