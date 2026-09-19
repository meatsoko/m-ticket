"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LookupPage() {
  const supabase = createClient();
  const [phone, setPhone] = useState("");
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true);
    const { data } = await supabase.functions.invoke("lookup", { body: { phone } });
    setTickets(data?.tickets ?? []);
    setBusy(false);
  }

  return (
    <div className="container">
      <h1>Find my tickets</h1>
      <div className="card">
        <input placeholder="M-Pesa phone used at purchase (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button onClick={find} disabled={busy || phone.length < 9} style={{ width: "100%" }}>
          {busy ? "Searching…" : "Find tickets"}
        </button>
        {tickets !== null && tickets.length === 0 && <p>No active tickets found for this number.</p>}
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
