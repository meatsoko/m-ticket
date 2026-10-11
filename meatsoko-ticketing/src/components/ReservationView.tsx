"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";

const KE = "Africa/Nairobi";
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, dateStyle: "full", timeStyle: "short" })
    .format(new Date(iso));

export default function ReservationView({ token }: { token: string }) {
  const supabase = createClient();
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    invokeFn(supabase, "reservation-by-token", { token })
      .then((res) => {
        if (res.transportError) return setErr("Could not load this reservation. Check your connection.");
        if (!res.data || res.data.error) return setErr("Reservation not found.");
        setR(res.data);
      })
      .catch(() => setErr("Could not load this reservation."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (err) return <div className="empty"><Icon name="ticket" size={28} /><strong>{err}</strong></div>;
  if (!r) return <div className="empty"><span className="small">Loading…</span></div>;

  const url = `${window.location.origin}/r/${r.token}`;
  const awaitingPayment = r.status === "pending_payment";
  const checkedIn = r.status === "checked_in";
  const valid = r.status === "confirmed";

  return (
    <div className="stack">
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className={`pill ${valid ? "ok" : checkedIn ? "warn" : awaitingPayment ? "warn" : "danger"}`}>
          {valid ? "Confirmed" : checkedIn ? "Already checked in"
            : awaitingPayment ? "Awaiting payment" : "Cancelled"}
        </span>
        <h2>{r.event?.name}</h2>
        {r.event?.tagline && <p className="small">{r.event.tagline}</p>}
        <p className="small">
          {r.event?.venue}{r.event?.starts_at ? ` · ${when(r.event.starts_at)}` : ""}
        </p>

        {(valid || checkedIn) && (
          <>
            <QrImage value={url} />
            <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{r.reservation_number}</strong>
          </>
        )}

        <div className="row" style={{ width: "100%", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pill">{r.guest_name}</span>
          <span className="pill ember">{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</span>
          {r.expected_arrival && <span className="pill">Arriving {String(r.expected_arrival).slice(0, 5)}</span>}
        </div>

        {r.preorder?.length > 0 && (
          <div className="card quiet" style={{ width: "100%" }}>
            <span className="eyebrow">Preorder</span>
            {r.preorder.map((p: any, i: number) => (
              <div className="row" key={i}>
                <span className="small">{p.qty} × {p.name}</span>
                <span className="small num">KSh {(p.qty * Number(p.unit_price_kes)).toLocaleString()}</span>
              </div>
            ))}
            <div className="row">
              <strong className="small">
                {r.payment_status === "paid" ? "Paid" : "Not yet paid"}
              </strong>
              <strong className="num">KSh {Number(r.amount_kes).toLocaleString()}</strong>
            </div>
          </div>
        )}

        {valid && <p className="small">Show this at the door. Screenshot it — it works offline.</p>}
        {awaitingPayment && (
          <p className="small">
            Your place is held, but the preorder is not paid yet. Reserve again with the same
            phone number to get a fresh M-Pesa prompt.
          </p>
        )}
        {checkedIn && <p className="small">Checked in — this pass cannot be used again.</p>}

        {(valid || checkedIn) && (
          <a className="btn btn-ghost btn-block"
            href={`https://wa.me/?text=${encodeURIComponent(
              `Reservation ${r.reservation_number} for ${r.event?.name}: ${url}`)}`}>
            <Icon name="share" size={18} /> Share via WhatsApp
          </a>
        )}
      </div>
      {r.event?.contact_phone && (
        <p className="small" style={{ textAlign: "center" }}>
          Questions? <a href={`tel:${r.event.contact_phone}`}>{r.event.contact_phone}</a>
        </p>
      )}
    </div>
  );
}
