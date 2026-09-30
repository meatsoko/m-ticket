"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { useBag } from "./BagProvider";
import { formatPrice } from "@/lib/merchandise";
import { SUPPORT } from "@/lib/support";

type OrderItem = { product_name: string; color: string; size: string; sku: string; qty: number; unit_price_usd: number };
export type MerchOrder = {
  order_number: string; access_token: string; first_name: string;
  payment_status: "pending" | "paid" | "failed" | "refunded" | "flagged";
  needs_attention: boolean;
  fulfilment_status: "unfulfilled" | "packed" | "ready_for_pickup" | "dispatched" | "delivered" | "collected" | "cancelled";
  delivery: { code: string; label: string; blurb: string | null; town: string | null };
  items: OrderItem[];
  subtotal_usd: number; delivery_fee_usd: number; total_usd: number; total_kes: number;
  created_at: string; paid_at: string | null; dispatched_at: string | null; completed_at: string | null;
  verification: string | null;
};

const kes = (n: number) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;
const usd = (n: number) => formatPrice(Number(n));
const when = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
  : null;

const STEPS: { key: MerchOrder["fulfilment_status"][]; label: string }[] = [
  { key: ["unfulfilled"], label: "Order confirmed" },
  { key: ["packed"], label: "Packed" },
  { key: ["ready_for_pickup", "dispatched"], label: "Ready / on its way" },
  { key: ["delivered", "collected"], label: "Delivered or collected" },
];

/**
 * Loads an order by Paystack reference (straight back from payment) or by access
 * token (the order page). By reference it polls briefly: the buyer often lands
 * here a moment before Paystack's webhook, and merch-order verifies on the spot.
 */
export default function OrderView({ reference, token }: { reference?: string; token?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { clear } = useBag();
  const [order, setOrder] = useState<MerchOrder | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const attempts = useRef(0);
  const cleared = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      const res = await invokeFn<MerchOrder>(supabase, "merch-order", reference ? { reference } : { access_token: token });
      if (cancelled) return;
      if (res.status === 404) { setState("not_found"); return; }
      if (!res.data || res.errorCode || res.transportError) { setState("error"); return; }
      setOrder(res.data);
      setState("ready");
      if (res.data.payment_status === "paid" && reference && !cleared.current) { cleared.current = true; clear(); }
      // Still pending straight after payment: ask again a few times.
      if (reference && res.data.payment_status === "pending" && attempts.current < 6) {
        attempts.current += 1;
        timer = window.setTimeout(load, 3000);
      }
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [supabase, reference, token, clear]);

  if (state === "loading") {
    return <div className="order-panel order-loading"><span className="order-spinner" aria-hidden="true" /><p>{reference ? "Confirming your payment…" : "Loading your order…"}</p></div>;
  }
  if (state === "not_found") {
    return <div className="order-panel"><h2>We couldn’t find that order</h2><p>Check the link in your confirmation email, or call or WhatsApp us on <a href={SUPPORT.tel}>{SUPPORT.display}</a> with your order number.</p><Link href="/shop" className="store-button">Back to the shop <span>↗</span></Link></div>;
  }
  if (state === "error" || !order) {
    return <div className="order-panel"><h2>Something went wrong</h2><p>We couldn’t load your order just now. Please refresh in a moment.</p></div>;
  }

  const status = order.payment_status;
  const stepIndex = STEPS.findIndex((s) => s.key.includes(order.fulfilment_status));

  return (
    <div className="order-view">
      <div className={`order-status order-status-${status}`}>
        {status === "paid" && <><span className="store-eyebrow">ORDER {order.order_number}</span><h2>Thank you, {order.first_name} — your order is confirmed.</h2><p>We’ve emailed your receipt. Keep your order number for pickup or delivery.</p></>}
        {status === "pending" && <><span className="store-eyebrow">ORDER {order.order_number}</span><h2>Waiting for payment confirmation</h2><p>This usually takes a few seconds. If you’ve paid, you’ll get a confirmation email as soon as Paystack tells us — you can safely close this page.</p></>}
        {status === "failed" && <><span className="store-eyebrow">ORDER {order.order_number}</span><h2>Your payment didn’t go through</h2><p>Nothing was charged. Your bag is still saved — you can try again.</p><Link href="/checkout" className="store-button">Back to checkout <span>→</span></Link></>}
        {status === "flagged" && <><span className="store-eyebrow">ORDER {order.order_number}</span><h2>We’re checking your order</h2><p>Your payment reached us, but something needs a quick look from our team. We’ll contact you by email — you don’t need to pay again.</p></>}
        {status === "refunded" && <><span className="store-eyebrow">ORDER {order.order_number}</span><h2>This order was refunded</h2><p>Questions about the refund? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a> with your order number.</p></>}
      </div>

      {status === "paid" && order.fulfilment_status !== "cancelled" && (
        <ol className="order-steps" aria-label="Order progress">
          {STEPS.map((s, i) => <li key={s.label} className={i <= stepIndex ? "done" : undefined}>{s.label}</li>)}
        </ol>
      )}

      <div className="order-grid">
        <section className="order-card">
          <h3>Items</h3>
          <ul className="order-items">
            {order.items.map((i) => (
              <li key={i.sku}><span><strong>{i.product_name}</strong><small>{i.color} · {i.size} · × {i.qty}</small></span><span>{usd(i.unit_price_usd * i.qty)}</span></li>
            ))}
          </ul>
          <div className="summary-row"><span>Subtotal</span><span>{usd(order.subtotal_usd)}</span></div>
          <div className="summary-row"><span>{order.delivery.label}</span><span>{Number(order.delivery_fee_usd) ? usd(order.delivery_fee_usd) : "Free"}</span></div>
          <div className="summary-row total"><span>Total</span><strong>{usd(order.total_usd)}</strong></div>
          {status !== "pending" && status !== "failed" && <p className="order-charged">Charged by Paystack as {kes(order.total_kes)}</p>}
        </section>
        <section className="order-card">
          <h3>Delivery</h3>
          <p><strong>{order.delivery.label}</strong>{order.delivery.town ? ` — ${order.delivery.town}` : ""}</p>
          {order.delivery.blurb && <p className="muted">{order.delivery.blurb}</p>}
          <dl className="order-dates">
            <div><dt>Placed</dt><dd>{when(order.created_at)}</dd></div>
            {order.paid_at && <div><dt>Paid</dt><dd>{when(order.paid_at)}</dd></div>}
            {order.dispatched_at && <div><dt>Dispatched</dt><dd>{when(order.dispatched_at)}</dd></div>}
            {order.completed_at && <div><dt>Completed</dt><dd>{when(order.completed_at)}</dd></div>}
          </dl>
          {reference && <Link href={`/order/${order.access_token}`} className="store-back-link">Bookmark your order page →</Link>}
        </section>
      </div>
      <p className="order-support">
        Questions about your order? Call or WhatsApp{" "}
        <a href={SUPPORT.tel}>{SUPPORT.display}</a> · <a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
      </p>
      <Link href="/shop" className="store-back-link">← Continue shopping</Link>
    </div>
  );
}
