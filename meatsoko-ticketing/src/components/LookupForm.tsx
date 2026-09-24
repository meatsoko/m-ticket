"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import Icon from "@/components/Icon";

// Same shape the Edge Function and looks_like_email() both enforce.
const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/**
 * One field, two kinds of pass. A guest should not have to know whether they
 * bought a ticket or reserved a place — an event running free reservations has
 * no M-Pesa number to remember, so the address the pass was emailed to is the
 * only identifier most of them still hold.
 */
export default function LookupForm() {
  const supabase = createClient();
  const [id, setId] = useState("");
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [reservations, setReservations] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isEmail = id.includes("@");
  const ready = isEmail ? looksLikeEmail(id) : id.replace(/\D/g, "").length >= 9;

  function failureOf(res: any): string | null {
    if (res.errorCode === "rate_limited") return "Too many lookups. Wait a few minutes and try again.";
    if (res.errorCode === "invalid_phone") return "That number doesn't look right. Use 07XX XXX XXX.";
    if (res.errorCode === "invalid_email") return "That email address doesn't look right.";
    if (res.transportError || !res.data) return "Could not reach the ticket service. Check your connection.";
    return null;
  }

  async function find() {
    setBusy(true); setErr("");
    const clear = () => { setTickets(null); setReservations(null); };

    if (isEmail) {
      const res = await invokeFn(supabase, "reservation-lookup", { email: id.trim() });
      setBusy(false);
      const msg = failureOf(res);
      if (msg) { setErr(msg); clear(); return; }
      setReservations(res.data.reservations ?? []);
      setTickets([]);
      return;
    }

    const t = await invokeFn(supabase, "lookup", { phone: id });
    const tMsg = failureOf(t);
    if (tMsg) { setBusy(false); setErr(tMsg); clear(); return; }
    setTickets(t.data.tickets ?? []);

    // Reservation guests give a phone as well as an email, so most of them will
    // type the number here. Without this second call they would hit the same
    // dead end as before, just in a better-looking form. A failure is not worth
    // surfacing — the ticket result above already succeeded.
    const r = await invokeFn(supabase, "reservation-lookup", { phone: id });
    setBusy(false);
    setReservations(r.transportError ? [] : (r.data?.reservations ?? []));
  }

  const nothingFound =
    tickets !== null && reservations !== null &&
    tickets.length === 0 && reservations.length === 0 && !err;

  return (
    <div className="stack">
      <div className="card">
        <label className="field">
          <span>Your phone number or email address</span>
          <input
            type="text" inputMode="text" autoComplete="email"
            placeholder="07XX XXX XXX or you@example.com"
            value={id} onChange={(e) => setId(e.target.value)}
          />
        </label>
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button
          className="btn-primary btn-block"
          onClick={find}
          disabled={busy || !ready}
        >
          {busy ? "Searching…" : "Find my pass"}
        </button>
        <p className="small">Only unused tickets and reservations still to arrive are shown, for your privacy.</p>
      </div>

      {nothingFound && (
        <div className="empty">
          <Icon name="search" size={28} />
          <strong>Nothing active found</strong>
          <p className="small">
            Nothing for that {isEmail ? "email address" : "number"}. Passes already
            scanned at the door aren&apos;t listed.
          </p>
        </div>
      )}

      {reservations?.map((r) => (
        <a key={r.token} className="card" href={`/r/${r.token}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <div className="stack tight">
              <strong>{r.reservation_number}</strong>
              <span className="small">
                {r.event}{r.party_size > 1 ? ` · party of ${r.party_size}` : ""}
              </span>
            </div>
            <span className="pill ember">Open →</span>
          </div>
        </a>
      ))}

      {tickets?.map((t) => (
        <a key={t.token} className="card" href={`/t/${t.token}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <div className="stack tight">
              <strong>{t.type}</strong>
              {t.bundle > 1 && <span className="small">Admits {t.bundle}</span>}
            </div>
            <span className="pill ember">Open →</span>
          </div>
        </a>
      ))}
    </div>
  );
}
