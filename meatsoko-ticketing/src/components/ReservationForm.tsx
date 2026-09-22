"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";
import type { Event, PreorderItem } from "@/lib/types";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

type Phase = "form" | "submitting" | "awaiting_payment" | "done" | "failed";

type Confirmed = {
  reservation_number: string;
  access_token: string;
  party_size: number;
  amount_kes: number;
};

export default function ReservationForm({
  event, items,
}: {
  event: Event;
  items: PreorderItem[];
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [accompanying, setAccompanying] = useState(0);
  const [arrival, setArrival] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmed | null>(null);

  const offersPreorders = event.reservation_mode !== "free" && items.length > 0;
  const preorders = items
    .filter((i) => (qty[i.id] || 0) > 0)
    .map((i) => ({ preorder_item_id: i.id, qty: qty[i.id] }));
  const total = items.reduce((s, i) => s + (qty[i.id] || 0) * Number(i.price_kes), 0);
  const partySize = 1 + accompanying;
  const maxParty = event.max_party_size ?? 10;

  const bump = (i: PreorderItem, d: number) =>
    setQty({ ...qty, [i.id]: Math.max(0, Math.min(i.max_per_reservation, (qty[i.id] || 0) + d)) });

  async function submit() {
    setError("");
    setPhase("submitting");

    const res = await invokeFn(supabase, "reserve", {
      event_id: event.id,
      guest_name: name.trim(),
      phone,
      email: email.trim() || undefined,
      accompanying_guests: accompanying,
      expected_arrival: arrival || undefined,
      preorders,
    });

    if (!res.data?.reservation_number) {
      setError(explain(res));
      setPhase("failed");
      return;
    }

    const confirmed: Confirmed = {
      reservation_number: res.data.reservation_number,
      access_token: res.data.access_token,
      party_size: res.data.party_size,
      amount_kes: res.data.amount_kes ?? 0,
    };
    setDone(confirmed);

    // Free reservation: already confirmed, no payment step at all.
    if (!res.data.payment_required) {
      setPhase("done");
      return;
    }

    // Preorder: the STK prompt is already on the guest's phone. Poll the
    // reservation, not the order — the access token is unguessable.
    setPhase("awaiting_payment");
    for (let i = 0; i < 34; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await invokeFn(supabase, "reservation-status", {
        access_token: confirmed.access_token,
      });
      if (st?.status === "confirmed" || st?.payment_status === "paid") { setPhase("done"); return; }
      if (st?.payment_status === "failed") {
        setError("Payment was cancelled or timed out. Your reservation is held — tap below to pay again.");
        setPhase("failed");
        return;
      }
      if (st?.payment_status === "flagged") {
        setError("Payment received but we could not confirm your preorder. Our team has been alerted — contact us with your M-Pesa message.");
        setPhase("failed");
        return;
      }
    }
    setError("Payment not completed in time. Your reservation is held — you can pay again below.");
    setPhase("failed");
  }

  function explain(res: { data: any; errorCode: string | null; transportError: boolean }): string {
    if (res.transportError) return "Could not reach the reservation service. Check your connection.";
    const d = res.data ?? {};
    switch (res.errorCode) {
      case "rate_limited":
        return `Too many attempts. Wait ${Math.ceil((d.retry_after ?? 60) / 60)} minute(s) and try again.`;
      case "full":
        return `Sorry — the guest list is full${d.remaining ? `. Only ${d.remaining} place(s) left` : ""}.`;
      case "party_too_large":
        return `Parties are limited to ${d.max_party_size} people.`;
      case "preorder_sold_out":
        return `${d.item ?? "That item"} is sold out${d.remaining ? ` — ${d.remaining} left` : ""}.`;
      case "closed":
        return "Reservations for this event have closed.";
      case "not_open_yet":
        return "Reservations aren't open yet. Check back soon.";
      case "invalid_phone":
        return "That phone number doesn't look right. Use the format 07XX XXX XXX.";
      case "invalid_name":
        return "Please enter your full name.";
      case "preorder_required":
        return "This event requires a preorder. Select at least one item.";
      case "stk_failed":
        return "M-Pesa did not accept the payment request. Your place is held — try paying again.";
      default:
        return `Could not complete your reservation${d.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
    }
  }

  // ---------- Confirmed ----------
  if (phase === "done" && done) {
    const url = `${APP_URL()}/r/${done.access_token}`;
    return (
      <div className="stack">
        <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pill ok">Reservation confirmed</span>
          <h2>See you there, {name.split(" ")[0]}.</h2>
          <p className="small">Show this at the door. Screenshot it — it works offline.</p>
          <QrImage value={url} />
          <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
          <span className="pill ember">
            {done.party_size} {done.party_size === 1 ? "guest" : "guests"}
          </span>
          {done.amount_kes > 0 && (
            <span className="pill ok">Preorder paid · KSh {done.amount_kes.toLocaleString()}</span>
          )}
          <a
            className="btn btn-ghost btn-block"
            href={`https://wa.me/?text=${encodeURIComponent(
              `My ${event.name} reservation (${done.reservation_number}) — open at the door: ${url}`
            )}`}
          >
            <Icon name="share" size={18} /> Send via WhatsApp
          </a>
        </div>
        <p className="small" style={{ textAlign: "center" }}>
          Lost this page? Find it again under <a href="/lookup">My Tickets</a>.
        </p>
      </div>
    );
  }

  // ---------- Awaiting M-Pesa ----------
  if (phase === "awaiting_payment") {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <span className="pill warn">Waiting for payment</span>
        <h2>Check your phone</h2>
        <p className="small">
          Enter your M-Pesa PIN to pay <strong>KSh {total.toLocaleString()}</strong> for your preorder.
          Your place is already held — this page updates on its own.
        </p>
      </div>
    );
  }

  // ---------- Form ----------
  return (
    <div className="stack">
      <span className="eyebrow">Reserve your place</span>

      <div className="card">
        <label className="field">
          <span>Full name</span>
          <input autoComplete="name" placeholder="Amina Wanjiru"
            value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Phone number</span>
          <input type="tel" inputMode="numeric" autoComplete="tel" placeholder="07XX XXX XXX"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>Email <span className="small">(optional)</span></span>
          <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <div className="row">
          <div className="stack tight" style={{ minWidth: 0 }}>
            <strong>Anyone coming with you?</strong>
            <span className="small">
              {partySize} {partySize === 1 ? "person" : "people"} in total, including you
            </span>
          </div>
          <div className="stepper">
            <button onClick={() => setAccompanying(Math.max(0, accompanying - 1))}
              disabled={accompanying === 0} aria-label="One fewer guest">−</button>
            <span className="qty" aria-live="polite">{accompanying}</span>
            <button onClick={() => setAccompanying(Math.min(maxParty - 1, accompanying + 1))}
              disabled={partySize >= maxParty} aria-label="One more guest">+</button>
          </div>
        </div>

        <label className="field">
          <span>What time do you expect to arrive? <span className="small">(optional)</span></span>
          <input type="time" value={arrival} onChange={(e) => setArrival(e.target.value)} />
        </label>
      </div>

      {offersPreorders && (
        <>
          <span className="eyebrow">Preorder <span className="small">(optional)</span></span>
          <div className="card flush">
            {items.map((i) => (
              <div className="tt" key={i.id}>
                <div className="row">
                  <div className="stack tight" style={{ minWidth: 0 }}>
                    <strong>{i.name}</strong>
                    {i.description && <span className="small">{i.description}</span>}
                    <span className="price">KSh {Number(i.price_kes).toLocaleString()}</span>
                  </div>
                  <div className="stepper">
                    <button onClick={() => bump(i, -1)} disabled={!qty[i.id]}
                      aria-label={`One fewer ${i.name}`}>−</button>
                    <span className="qty">{qty[i.id] || 0}</span>
                    <button onClick={() => bump(i, 1)}
                      disabled={(qty[i.id] || 0) >= i.max_per_reservation}
                      aria-label={`One more ${i.name}`}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card">
        {total > 0 && (
          <div className="row">
            <span>Preorder total</span>
            <strong className="num">KSh {total.toLocaleString()}</strong>
          </div>
        )}
        {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
        <button
          className={total > 0 ? "btn-pay btn-block" : "btn-primary btn-block"}
          onClick={submit}
          disabled={
            phase === "submitting" ||
            name.trim().length < 2 ||
            phone.replace(/\D/g, "").length < 9
          }
        >
          {phase === "submitting"
            ? "Reserving…"
            : total > 0
            ? `${phase === "failed" ? "Retry —" : "Reserve & pay"} KSh ${total.toLocaleString()}`
            : phase === "failed" ? "Try again" : "Reserve my place"}
        </button>
        <p className="small" style={{ textAlign: "center" }}>
          {total > 0
            ? "You'll get an M-Pesa prompt. Your place is held while you pay."
            : "Free to reserve. No payment needed."}
        </p>
      </div>
    </div>
  );
}
