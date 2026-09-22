"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

export default function LookupPage() {
  const supabase = createClient();
  const [phone, setPhone] = useState("");
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function find() {
    setBusy(true);
    setErr("");
    const res = await invokeFn(supabase, "lookup", { phone });
    setBusy(false);
    if (res.errorCode === "rate_limited") {
      setErr("Too many lookups. Please wait a few minutes and try again.");
      setTickets(null);
      return;
    }
    if (res.errorCode === "invalid_phone") {
      setErr("That phone number doesn't look right. Use the format 07XX XXX XXX.");
      setTickets(null);
      return;
    }
    if (res.transportError || !res.data) {
      setErr("Could not reach the ticket service. Check your connection.");
      setTickets(null);
      return;
    }
    setTickets(res.data.tickets ?? []);
  }

  return (
    <div className="container">
      <h1>Find my tickets</h1>
      <div className="card">
        <input placeholder="M-Pesa phone used at purchase (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button onClick={find} disabled={busy || phone.length < 9} style={{ width: "100%" }}>
          {busy ? "Searching…" : "Find tickets"}
        </button>
        {err && <p style={{ color: "var(--red)" }}>{err}</p>}
        {!err && tickets !== null && tickets.length === 0 && <p>No active tickets found for this number.</p>}
      </div>
      {tickets?.map((t) => (
        <a key={t.token} className="card" href={`/t/${t.token}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <strong>{t.type}</strong>{t.bundle > 1 ? ` (admits ${t.bundle})` : ""}
          <p className="small">Tap to open ticket →</p>
        </a>
      ))}
    </div>
  );
}
