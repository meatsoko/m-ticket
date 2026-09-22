"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";
import type { Event, TicketType, OrderTicket } from "@/lib/types";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

type InvokeResult = {
  data: any; status: number | null; errorCode: string | null; transportError: boolean;
};

export default function EventCheckout({
  event, types, remaining = {}, sold = {},
}: {
  event: Event;
  types: TicketType[];
  remaining?: Record<string, number | null>;
  sold?: Record<string, number>;
}) {
  const supabase = createClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"form" | "pending" | "success" | "failed">("form");
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [error, setError] = useState("");
  // FR-P6: a retry reuses this order row with a fresh checkout id.
  const [orderId, setOrderId] = useState<string | null>(null);

  const left = (t: TicketType) => remaining[t.id] ?? null;
  const soldOut = (t: TicketType) => left(t) === 0;
  const maxQty = (t: TicketType) => {
    const r = left(t);
    return r === null ? 8 : Math.min(8, Math.floor(r / (t.bundle_qty || 1)));
  };

  const total = types.reduce((s, t) => s + (qty[t.id] || 0) * Number(t.price_kes), 0);
  const items = types.filter((t) => (qty[t.id] || 0) > 0)
    .map((t) => ({ ticket_type_id: t.id, qty: qty[t.id] }));
  const count = items.reduce((s, i) => s + i.qty, 0);

  const bump = (t: TicketType, delta: number) => {
    const next = Math.max(0, Math.min(maxQty(t), (qty[t.id] || 0) + delta));
    setQty({ ...qty, [t.id]: next });
  };

  async function pay() {
    setError("");
    setState("pending");
    const res = await invokeFn(supabase, "stk-push", {
      event_id: event.id, phone, buyer_email: email || undefined, items,
      ...(orderId ? { order_id: orderId } : {}),
    });
    if (res.data?.orderId) setOrderId(res.data.orderId);
    if (!res.data?.checkoutRequestId) {
      setError(explain(res));
      setState("failed");
      return;
    }
    const checkoutRequestId = res.data.checkoutRequestId;

    // FR-P3: poll for the callback, ~100s.
    for (let i = 0; i < 34; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await invokeFn(supabase, "order-status", { checkoutRequestId });
      if (st?.status === "paid") { setTickets(st.tickets ?? []); setState("success"); return; }
      if (st?.status === "failed") {
        setError("Payment was cancelled or timed out. Tap below to try again.");
        setState("failed"); return;
      }
      if (st?.status === "flagged") {
        setError("Payment received but the ticket could not be issued. Our team has been alerted — contact us with your M-Pesa message.");
        setState("failed"); return;
      }
      if (st?.status === "unknown") break;
    }
    setError("Payment not completed in time. If you were charged, find your ticket under My Tickets.");
    setState("failed");
  }

  function explain(res: InvokeResult): string {
    if (res.transportError) return "Could not reach the payment service. Check your connection and try again.";
    const d = res.data ?? {};
    switch (res.errorCode) {
      case "rate_limited":
        return `Too many payment attempts. Wait ${Math.ceil((d.retry_after ?? 60) / 60)} minute(s) and try again.`;
      case "sold_out":
        return `${d.ticket_type ?? "That ticket"} is sold out${d.remaining ? ` — only ${d.remaining} left` : ""}.`;
      case "event_not_live":
      case "event_not_found":
        return "Ticket sales for this event are closed.";
      case "invalid_phone":
        return "That phone number doesn't look right. Use the format 07XX XXX XXX.";
      case "no_items":
        return "Choose at least one ticket first.";
      case "stk_failed":
        return "M-Pesa did not accept the request. Check the number and try again.";
      case "daraja_misconfigured":
        return "Payments are temporarily unavailable. Please try again shortly.";
      default:
        return `Could not start payment${d.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
    }
  }

  // ---------- Success ----------
  if (state === "success") {
    return (
      <div className="stack">
        <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pill ok">Payment received</span>
          <h2>You&apos;re going.</h2>
          <p className="small">Show each QR code at the gate. Screenshot this page.</p>
        </div>

        {tickets.map((t, i) => (
          <div className="card" key={t.qr_token} style={{ alignItems: "center", textAlign: "center" }}>
            <div className="row" style={{ width: "100%" }}>
              <strong>{t.ticket_types?.name}</strong>
              <span className="small num">{i + 1} of {tickets.length}</span>
            </div>
            <QrImage value={`${APP_URL()}/t/${t.qr_token}`} />
            {t.ticket_types?.bundle_qty && t.ticket_types.bundle_qty > 1 ? (
              <span className="pill ember">Admits {t.ticket_types.bundle_qty}</span>
            ) : null}
            <a
              className="btn btn-ghost btn-block"
              href={`https://wa.me/?text=${encodeURIComponent(
                `My ${event.name} ticket — open to show at the gate: ${APP_URL()}/t/${t.qr_token}`
              )}`}
            >
              <Icon name="share" size={18} /> Send via WhatsApp
            </a>
          </div>
        ))}

        <p className="small" style={{ textAlign: "center" }}>
          Lost this page? Find your tickets any time under <a href="/lookup">My Tickets</a>.
        </p>
      </div>
    );
  }

  // ---------- Pending ----------
  if (state === "pending") {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <span className="pill warn">Waiting for payment</span>
        <h2>Check your phone</h2>
        <p className="small">
          Enter your M-Pesa PIN to pay <strong>KSh {total.toLocaleString()}</strong>.
          This page updates on its own — don&apos;t close it.
        </p>
      </div>
    );
  }

  // ---------- Selection + payment ----------
  return (
    <div className="stack">
      <span className="eyebrow">Tickets</span>

      <div className="card flush">
        {types.map((t) => {
          const r = left(t);
          const s = sold[t.id] ?? 0;
          const cap = r === null ? null : s + r;
          const pct = cap && cap > 0 ? Math.min(100, Math.round((s / cap) * 100)) : 0;
          const out = soldOut(t);
          return (
            <div className={`tt${out ? " sold-out" : ""}`} key={t.id}>
              <div className="row">
                <div className="stack tight" style={{ minWidth: 0 }}>
                  <strong>{t.name}</strong>
                  <span className="price">KSh {Number(t.price_kes).toLocaleString()}</span>
                  {t.bundle_qty > 1 && <span className="small">Admits {t.bundle_qty} people</span>}
                </div>
                {out ? (
                  <span className="pill danger">Sold out</span>
                ) : (
                  <div className="stepper">
                    <button onClick={() => bump(t, -1)} disabled={!qty[t.id]} aria-label={`One fewer ${t.name}`}>−</button>
                    <span className="qty" aria-live="polite">{qty[t.id] || 0}</span>
                    <button onClick={() => bump(t, 1)} disabled={(qty[t.id] || 0) >= maxQty(t)} aria-label={`One more ${t.name}`}>+</button>
                  </div>
                )}
              </div>

              {/* Honest scarcity: absolute numbers, because a trader deciding
                  whether to send two staff wants the count, not a percentage. */}
              {cap !== null && (
                <div className="stack tight">
                  <div className={`meter${r !== null && r <= cap * 0.1 ? " low" : ""}`}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <span className="small num">
                    {out ? `All ${cap} sold` : `${s} of ${cap} sold · ${r} left`}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <label className="field">
          <span>M-Pesa number</span>
          <input
            type="tel" inputMode="numeric" autoComplete="tel"
            placeholder="07XX XXX XXX"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Email <span className="small">(optional)</span></span>
          <input
            type="email" inputMode="email" autoComplete="email"
            placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}

        <button
          className="btn-pay btn-block"
          disabled={items.length === 0 || phone.replace(/\D/g, "").length < 9}
          onClick={pay}
        >
          {items.length === 0
            ? "Select a ticket"
            : `${state === "failed" ? "Retry —" : "Pay"} KSh ${total.toLocaleString()}`}
        </button>
        <p className="small" style={{ textAlign: "center" }}>
          {count > 0 ? `${count} ticket${count > 1 ? "s" : ""} · ` : ""}
          Price includes all fees. You&apos;ll get an M-Pesa prompt.
        </p>
      </div>
    </div>
  );
}
