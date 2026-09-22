"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import QrImage from "@/components/QrImage";
import type { Event, TicketType, OrderTicket } from "@/lib/types";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

export default function EventCheckout({
  event, types, remaining = {},
}: {
  event: Event;
  types: TicketType[];
  remaining?: Record<string, number | null>;
}) {
  // null cap means unlimited; 0 means sold out.
  const left = (t: TicketType) => remaining[t.id] ?? null;
  const soldOut = (t: TicketType) => left(t) === 0;
  const maxQty = (t: TicketType) => {
    const r = left(t);
    return r === null ? 8 : Math.min(8, Math.floor(r / (t.bundle_qty || 1)));
  };
  const supabase = createClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"form" | "pending" | "success" | "failed">("form");
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [error, setError] = useState("");
  // FR-P6: a retry reuses this order row with a fresh checkout id.
  const [orderId, setOrderId] = useState<string | null>(null);

  const total = types.reduce((s, t) => s + (qty[t.id] || 0) * Number(t.price_kes), 0);
  const items = types.filter((t) => (qty[t.id] || 0) > 0)
    .map((t) => ({ ticket_type_id: t.id, qty: qty[t.id] }));

  async function pay() {
    setError("");
    setState("pending");
    const res = await invokeFn(supabase, "stk-push", {
      event_id: event.id, phone, buyer_email: email || undefined, items,
      ...(orderId ? { order_id: orderId } : {}),
    });
    // Keep the order id from either a success or a failure so the retry reuses the row.
    if (res.data?.orderId) setOrderId(res.data.orderId);
    if (!res.data?.checkoutRequestId) {
      setError(explain(res));
      setState("failed");
      return;
    }
    const checkoutRequestId = res.data.checkoutRequestId;
    // Poll order status (FR-P3), up to ~100s
    for (let i = 0; i < 34; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await invokeFn(supabase, "order-status", { checkoutRequestId });
      if (st?.status === "paid") { setTickets(st.tickets ?? []); setState("success"); return; }
      if (st?.status === "failed") {
        setError("Payment was cancelled or timed out. Tap below to try again.");
        setState("failed");
        return;
      }
      if (st?.status === "flagged") {
        setError("Payment received but the ticket could not be issued. Our team has been alerted — contact us with your M-Pesa message.");
        setState("failed");
        return;
      }
      if (st?.status === "unknown") break;
    }
    setError("Payment not completed in time. If you were charged, use ticket lookup with your phone number.");
    setState("failed");
  }

  function explain(res: { data: any; status: number | null; errorCode: string | null; transportError: boolean }): string {
    if (res.transportError) {
      return "Could not reach the payment service. Check your connection and try again.";
    }
    const d = res.data ?? {};
    switch (res.errorCode) {
      case "rate_limited":
        return `Too many payment attempts. Wait ${Math.ceil((d.retry_after ?? 60) / 60)} minute(s) and try again.`;
      case "sold_out":
        return `${d.ticket_type ?? "That ticket"} is sold out${
          d.remaining ? ` — only ${d.remaining} left` : ""}.`;
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
        // `stage` says exactly how far the request got; worth showing so a support
        // message identifies the failure instead of describing a blank wall.
        return `Could not start payment${d.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
    }
  }

  if (state === "success") {
    const waText = encodeURIComponent(
      `My ${event.name} ticket(s) — open to show at the gate:`
    );
    return (
      <div className="card">
        <h2>Payment received 🎉</h2>
        <p className="small">Show each QR at the gate. Screenshot this page.</p>
        {tickets.map((t) => (
          <div key={t.qr_token} className="card" style={{ textAlign: "center" }}>
            <QrImage value={`${APP_URL()}/t/${t.qr_token}`} />
            <p className="badge">{t.ticket_types?.name}{t.ticket_types?.bundle_qty && t.ticket_types.bundle_qty > 1 ? ` (party of ${t.ticket_types.bundle_qty})` : ""}</p>
            <p className="small">Lost this page? Find tickets anytime: <a href="/lookup">meatsoko tickets lookup</a></p>
            <a className="btn" style={{ background: "#1e9e50" }}
              href={`https://wa.me/?text=${waText}%20${APP_URL()}/t/${t.qr_token}`}>
              Send via WhatsApp
            </a>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      {types.map((t) => {
        const r = left(t);
        return (
          <div className="row" key={t.id} style={{ padding: "8px 0" }}>
            <div>
              <strong>{t.name}</strong>{t.bundle_qty > 1 ? ` (admits ${t.bundle_qty})` : ""}
              <div className="price">KSh {Number(t.price_kes).toLocaleString()}</div>
              {soldOut(t)
                ? <span className="badge bad">Sold out</span>
                : r !== null && r <= 20 && <span className="small">Only {r} left</span>}
            </div>
            {soldOut(t) ? (
              <span className="small">—</span>
            ) : (
              <select
                value={qty[t.id] || 0}
                onChange={(e) => setQty({ ...qty, [t.id]: parseInt(e.target.value) })}
              >
                {Array.from({ length: maxQty(t) + 1 }, (_, n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}

      {state === "pending" ? (
        <p><strong>Check your phone…</strong><br />Enter your M-Pesa PIN to complete payment. This page updates automatically.</p>
      ) : (
        <>
          <input placeholder="M-Pesa phone (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          <button disabled={items.length === 0 || phone.length < 9} onClick={pay} style={{ width: "100%" }}>
            {state === "failed" ? "Retry" : "Pay"} KSh {total.toLocaleString()} via M-Pesa
          </button>
        </>
      )}
    </div>
  );
}
